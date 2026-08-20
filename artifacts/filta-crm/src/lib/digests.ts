// Digest computation — produces structured payloads for the daily and
// weekly admin-facing emails. Pure-ish: takes the date range + optional
// territory filter and returns data; the email rendering is done
// separately so the payload can be reused (UI preview, JSON API for a
// future Slack integration, etc.).
//
// "Pure-ish" because we DO call the DB. But everything's a single read;
// no writes, no side effects.

import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  accounts,
  emailEvents,
  emailSends,
  quoteVersions,
  serviceAgreements,
  tasks,
} from "@/db";

export type DigestRange = {
  startAt: Date; // inclusive
  endAt: Date; // exclusive
  /** "yesterday", "last 7 days", etc. — display string. */
  label: string;
};

export type DigestPayload = {
  range: DigestRange;
  /** Headline counters — these go in the subject line and tile row. */
  counters: {
    repliesReceived: number;
    quotesSent: number;
    quotesAccepted: number;
    agreementsSigned: number;
    overdueTasks: number;
    atRiskCustomers: number;
    fsTargetsRemaining: number;
  };
  /** Per-event detail rows for the email body. */
  events: {
    replies: Array<{
      accountId: string;
      companyName: string;
      subject: string;
      occurredAt: Date;
    }>;
    quotesSentList: Array<{
      quoteVersionId: string;
      opportunityId: string;
      companyName: string;
      annualValue: number;
      sentAt: Date;
    }>;
    quotesAcceptedList: Array<{
      quoteVersionId: string;
      opportunityId: string;
      companyName: string;
      annualValue: number;
      acceptedAt: Date;
    }>;
    agreementsSignedList: Array<{
      agreementId: string;
      accountId: string;
      companyName: string;
      signedName: string | null;
      signedAt: Date;
    }>;
  };
  /** MRR snapshot — only populated for weekly digests. Daily leaves null. */
  mrr: null | {
    currentTotal: number;
    /** Movement vs the prior period of equal length. */
    deltaVsPriorPeriod: number;
    fsAttachRate: number; // 0–100
  };
};

// ============================================================================
// RANGE HELPERS
// ============================================================================

/** Daily digest range — covers "from yesterday morning through now". */
export function dailyRange(now = new Date()): DigestRange {
  const end = new Date(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
  return { startAt: start, endAt: end, label: "the last 24 hours" };
}

/** Weekly digest range — last 7 days through now. */
export function weeklyRange(now = new Date()): DigestRange {
  const end = new Date(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { startAt: start, endAt: end, label: "the last 7 days" };
}

// ============================================================================
// COMPUTE
// ============================================================================

export async function computeDigest(
  range: DigestRange,
  opts: { includeMrr?: boolean } = {},
): Promise<DigestPayload> {
  const { startAt, endAt } = range;

  // ---- Replies received in the window ------------------------------------
  // 'replied' events are written by the inbound webhook (W4.1) when a
  // customer's reply is matched back to a sent. We pull the account name
  // via the email_sends join.
  const replyRows = await db
    .select({
      accountId: emailSends.accountId,
      companyName: accounts.companyName,
      subject: emailSends.subject,
      occurredAt: emailEvents.occurredAt,
    })
    .from(emailEvents)
    .innerJoin(emailSends, eq(emailSends.id, emailEvents.emailSendId))
    .innerJoin(accounts, eq(accounts.id, emailSends.accountId))
    .where(
      and(
        eq(emailEvents.eventType, "replied"),
        gte(emailEvents.occurredAt, startAt),
        lt(emailEvents.occurredAt, endAt),
      ),
    )
    .orderBy(sql`${emailEvents.occurredAt} desc`)
    .limit(50);

  // ---- Quotes sent in the window ----------------------------------------
  const quotesSentRows = await db
    .select({
      quoteVersionId: quoteVersions.id,
      opportunityId: quoteVersions.opportunityId,
      companyName: quoteVersions.customerCompanyName,
      annualValue: quoteVersions.estimatedAnnual,
      sentAt: quoteVersions.sentAt,
    })
    .from(quoteVersions)
    .where(
      and(
        gte(quoteVersions.sentAt, startAt),
        lt(quoteVersions.sentAt, endAt),
        isNull(quoteVersions.deletedAt),
      ),
    )
    .orderBy(sql`${quoteVersions.sentAt} desc`)
    .limit(50);

  // ---- Quotes accepted in the window -----------------------------------
  const quotesAcceptedRows = await db
    .select({
      quoteVersionId: quoteVersions.id,
      opportunityId: quoteVersions.opportunityId,
      companyName: quoteVersions.customerCompanyName,
      annualValue: quoteVersions.estimatedAnnual,
      acceptedAt: quoteVersions.acceptedAt,
    })
    .from(quoteVersions)
    .where(
      and(
        gte(quoteVersions.acceptedAt, startAt),
        lt(quoteVersions.acceptedAt, endAt),
        isNull(quoteVersions.deletedAt),
      ),
    )
    .orderBy(sql`${quoteVersions.acceptedAt} desc`)
    .limit(50);

  // ---- Agreements signed in the window ---------------------------------
  const agreementsSignedRows = await db
    .select({
      agreementId: serviceAgreements.id,
      accountId: serviceAgreements.accountId,
      companyName: accounts.companyName,
      signedName: serviceAgreements.customerSignedName,
      signedAt: serviceAgreements.customerSignedAt,
    })
    .from(serviceAgreements)
    .innerJoin(accounts, eq(accounts.id, serviceAgreements.accountId))
    .where(
      and(
        gte(serviceAgreements.customerSignedAt, startAt),
        lt(serviceAgreements.customerSignedAt, endAt),
        isNull(serviceAgreements.deletedAt),
      ),
    )
    .orderBy(sql`${serviceAgreements.customerSignedAt} desc`)
    .limit(50);

  // ---- Overdue tasks (point-in-time, regardless of range) --------------
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const [{ overdueCount }] = await db
    .select({
      overdueCount: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "open"),
        lt(tasks.dueDate, todayIso),
      ),
    );

  // ---- At-risk customers (point-in-time) -------------------------------
  // We don't fully recompute risk here — that's expensive. Instead we
  // surface the count from the same heuristic the at-risk page uses.
  // Approximation: customers with last activity > 60 days ago are
  // considered "watch / at_risk / critical." Refine later if the digest
  // numbers don't match the queue.
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setUTCDate(sixtyDaysAgo.getUTCDate() - 60);
  const [{ atRiskApprox }] = await db
    .select({
      atRiskApprox: sql<number>`count(*)::int`,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.accountStatus, "customer"),
        isNull(accounts.deletedAt),
        // Account either has no recent activity or is overdue on FF service.
        sql`(
          (select max(occurred_at) from activities where account_id = ${accounts.id}) < ${sixtyDaysAgo}
          or
          ((${accounts.serviceProfile}->'ff'->>'active')::boolean = true
            and ((${accounts.serviceProfile}->'ff'->>'last_service_date')::date) < (now() - interval '14 days'))
        )`,
      ),
    );

  // ---- FS targets remaining (current cross-sell list size) -------------
  const [{ fsTargetsRemaining }] = await db
    .select({ fsTargetsRemaining: sql<number>`count(*)::int` })
    .from(accounts)
    .where(
      and(
        eq(accounts.accountStatus, "customer"),
        isNull(accounts.deletedAt),
        sql`(${accounts.serviceProfile}->'ff'->>'active')::boolean = true`,
        sql`coalesce((${accounts.serviceProfile}->'fs'->>'active')::boolean, false) = false`,
        sql`not exists (
          select 1 from opportunities o
          where o.account_id = ${accounts.id}
            and o.service_type = 'fs'
            and o.stage not in ('closed_won','closed_lost')
            and o.deleted_at is null
        )`,
      ),
    );

  // ---- Optional MRR snapshot (weekly digests) --------------------------
  let mrr: DigestPayload["mrr"] = null;
  if (opts.includeMrr) {
    // Current MRR — sum across all customer accounts' service_profile.
    const [{ currentTotal }] = await db
      .select({
        currentTotal: sql<number>`coalesce(sum(
          coalesce((${accounts.serviceProfile}->'ff'->>'monthly_revenue')::numeric, 0) +
          coalesce((${accounts.serviceProfile}->'fs'->>'monthly_revenue')::numeric, 0) +
          coalesce((${accounts.serviceProfile}->'fb'->>'monthly_revenue')::numeric, 0) +
          coalesce((${accounts.serviceProfile}->'fg'->>'monthly_revenue')::numeric, 0) +
          coalesce((${accounts.serviceProfile}->'fc'->>'monthly_revenue')::numeric, 0) +
          coalesce((${accounts.serviceProfile}->'fd'->>'monthly_revenue')::numeric, 0)
        ), 0)`,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.accountStatus, "customer"),
          isNull(accounts.deletedAt),
        ),
      );

    // FS attach rate among FF customers.
    const [{ ffActive, fsActive }] = await db
      .select({
        ffActive: sql<number>`count(*) filter (where (${accounts.serviceProfile}->'ff'->>'active')::boolean = true)::int`,
        fsActive: sql<number>`count(*) filter (where (${accounts.serviceProfile}->'fs'->>'active')::boolean = true)::int`,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.accountStatus, "customer"),
          isNull(accounts.deletedAt),
        ),
      );

    const fsAttachRate =
      ffActive > 0 ? (Number(fsActive) / Number(ffActive)) * 100 : 0;

    // WoW delta = sum of MRR change events in the last 7 days. Approximated
    // as: signed agreements in window × their average annual value / 12.
    // Crude but actionable; refined later if accuracy matters.
    const acceptedAnnual = quotesAcceptedRows.reduce(
      (s, r) => s + Number(r.annualValue ?? 0),
      0,
    );
    const deltaVsPriorPeriod = Math.round((acceptedAnnual / 12) * 100) / 100;

    mrr = {
      currentTotal: Number(currentTotal),
      deltaVsPriorPeriod,
      fsAttachRate: Math.round(fsAttachRate * 10) / 10,
    };
  }

  return {
    range,
    counters: {
      repliesReceived: replyRows.length,
      quotesSent: quotesSentRows.length,
      quotesAccepted: quotesAcceptedRows.length,
      agreementsSigned: agreementsSignedRows.length,
      overdueTasks: Number(overdueCount),
      atRiskCustomers: Number(atRiskApprox),
      fsTargetsRemaining: Number(fsTargetsRemaining),
    },
    events: {
      replies: replyRows.map((r) => ({
        accountId: r.accountId,
        companyName: r.companyName,
        subject: r.subject,
        occurredAt: r.occurredAt as Date,
      })),
      quotesSentList: quotesSentRows.map((r) => ({
        quoteVersionId: r.quoteVersionId,
        opportunityId: r.opportunityId,
        companyName: r.companyName,
        annualValue: Number(r.annualValue ?? 0),
        sentAt: r.sentAt as Date,
      })),
      quotesAcceptedList: quotesAcceptedRows.map((r) => ({
        quoteVersionId: r.quoteVersionId,
        opportunityId: r.opportunityId,
        companyName: r.companyName,
        annualValue: Number(r.annualValue ?? 0),
        acceptedAt: r.acceptedAt as Date,
      })),
      agreementsSignedList: agreementsSignedRows.map((r) => ({
        agreementId: r.agreementId,
        accountId: r.accountId,
        companyName: r.companyName,
        signedName: r.signedName,
        signedAt: r.signedAt as Date,
      })),
    },
    mrr,
  };
}

// Convenience entry points
export async function computeDailyDigest(): Promise<DigestPayload> {
  return computeDigest(dailyRange());
}

export async function computeWeeklyDigest(): Promise<DigestPayload> {
  return computeDigest(weeklyRange(), { includeMrr: true });
}
