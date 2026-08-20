"use server";

// Server actions for Field Mode (/field) — the phone-first view the sales
// team uses between customer visits.
//
// Design notes:
// - quickUpdateAction is the core habit: dictate a note in the car, save,
//   done. It writes a 'visit' or 'note' activity (same table the rest of the
//   CRM reads) so nothing here is a parallel data model.
// - setFieldStageAction delegates to moveLeadStageAction / convertLeadAction
//   so the audit trail ("Funnel stage → x" notes) and RLS behavior stay
//   identical to the desktop kanban.
// - searchLeadsAction exists because the lead universe is ~5,600 rows —
//   too heavy to ship to the client. The default list is "worked" leads;
//   search reaches everything, server-side, capped at 30.

import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, activities, contacts, users, withSession } from "@/db";
import { requireSession } from "@/lib/session";
import { moveLeadStageAction, convertLeadAction } from "../leads/actions";
import type { DbStage } from "@/lib/field-stages";

// ---------------------------------------------------------------------------
// Shared row shape for list + search results
// ---------------------------------------------------------------------------

export type FieldLeadRow = {
  id: string;
  companyName: string;
  city: string | null;
  territory: string;
  stage: string;
  stageChangedAt: string; // ISO
  phone: string | null;
  phoneRaw: string | null;
  accountStatus: string;
  fryerCount: number | null;
  lastActivityAt: string | null;
  lastActivityBody: string | null;
  ownerFirstName: string | null;
};

const leadRowSelect = {
  id: accounts.id,
  companyName: accounts.companyName,
  city: accounts.city,
  territory: accounts.territory,
  stage: accounts.salesFunnelStage,
  stageChangedAt: accounts.salesFunnelStageChangedAt,
  phone: accounts.phone,
  phoneRaw: accounts.phoneRaw,
  accountStatus: accounts.accountStatus,
  fryerCount: accounts.fryerCount,
};

function territoryFilter(sessionTerritory: string) {
  if (sessionTerritory === "both") return undefined;
  return or(
    eq(accounts.territory, sessionTerritory as "fun_coast" | "space_coast"),
    eq(accounts.territory, "unassigned"),
  );
}

// ---------------------------------------------------------------------------
// SEARCH — reaches the full lead universe
// ---------------------------------------------------------------------------

const SearchInput = z.object({ q: z.string().min(2).max(80) });

export async function searchLeadsAction(input: {
  q: string;
}): Promise<{ ok: boolean; rows?: FieldLeadRow[]; error?: string }> {
  const session = await requireSession();
  const parsed = SearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Type at least 2 characters" };
  const q = `%${parsed.data.q.trim()}%`;

  return withSession(session, async (tx) => {
    const rows = await tx
      .select(leadRowSelect)
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          eq(accounts.accountStatus, "prospect"),
          territoryFilter(session.territory),
          or(
            ilike(accounts.companyName, q),
            ilike(accounts.city, q),
            ilike(accounts.phoneRaw, q),
            ilike(accounts.phone, q),
          ),
        ),
      )
      .orderBy(desc(accounts.updatedAt))
      .limit(30);

    return {
      ok: true,
      rows: rows.map((r) => ({
        ...r,
        stageChangedAt: r.stageChangedAt.toISOString(),
        lastActivityAt: null,
        lastActivityBody: null,
        ownerFirstName: null,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// LEAD CARD — everything Field Mode shows for one lead
// ---------------------------------------------------------------------------

export type FieldLeadCard = {
  id: string;
  companyName: string;
  dbaName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  territory: string;
  phone: string | null;
  phoneRaw: string | null;
  website: string | null;
  fryerCount: number | null;
  stage: string;
  stageChangedAt: string;
  accountStatus: string;
  ncaFlag: boolean;
  ncaName: string | null;
  leadSource: string;
  filtaRecordId: string | null;
  notes: string | null;
  primaryContact: {
    fullName: string | null;
    title: string | null;
    email: string | null;
    phoneMobile: string | null;
    phoneDirect: string | null;
  } | null;
  feed: {
    id: string;
    type: string;
    subject: string | null;
    body: string | null;
    occurredAt: string;
    ownerName: string | null;
  }[];
};

const CardInput = z.object({ accountId: z.string().uuid() });

export async function getLeadCardAction(input: {
  accountId: string;
}): Promise<{ ok: boolean; card?: FieldLeadCard; error?: string }> {
  const session = await requireSession();
  const parsed = CardInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid lead id" };
  const { accountId } = parsed.data;

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return { ok: false, error: "Lead not found" };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "You don't have access to that lead." };
    }

    const contactRows = await tx
      .select({
        fullName: contacts.fullName,
        title: contacts.title,
        email: contacts.email,
        phoneMobile: contacts.phoneMobile,
        phoneDirect: contacts.phoneDirect,
        isPrimary: contacts.isPrimary,
      })
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), isNull(contacts.deletedAt)))
      .orderBy(desc(contacts.isPrimary))
      .limit(1);

    const feedRows = await tx
      .select({
        id: activities.id,
        type: activities.type,
        subject: activities.subject,
        body: activities.body,
        occurredAt: activities.occurredAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.ownerUserId))
      .where(eq(activities.accountId, accountId))
      .orderBy(desc(activities.occurredAt))
      .limit(25);

    const card: FieldLeadCard = {
      id: acct.id,
      companyName: acct.companyName,
      dbaName: acct.dbaName,
      addressLine1: acct.addressLine1,
      city: acct.city,
      state: acct.state,
      zip: acct.zip,
      county: acct.county,
      territory: acct.territory,
      phone: acct.phone,
      phoneRaw: acct.phoneRaw,
      website: acct.website,
      fryerCount: acct.fryerCount,
      stage: acct.salesFunnelStage,
      stageChangedAt: acct.salesFunnelStageChangedAt.toISOString(),
      accountStatus: acct.accountStatus,
      ncaFlag: acct.ncaFlag,
      ncaName: acct.ncaName,
      leadSource: acct.leadSource,
      filtaRecordId: acct.filtaRecordId,
      notes: acct.notes,
      primaryContact: contactRows[0]
        ? {
            fullName: contactRows[0].fullName,
            title: contactRows[0].title,
            email: contactRows[0].email,
            phoneMobile: contactRows[0].phoneMobile,
            phoneDirect: contactRows[0].phoneDirect,
          }
        : null,
      feed: feedRows.map((f) => ({
        id: f.id,
        type: f.type,
        subject: f.subject,
        body: f.body,
        occurredAt: f.occurredAt.toISOString(),
        ownerName: f.firstName ? `${f.firstName} ${f.lastName ?? ""}`.trim() : null,
      })),
    };

    return { ok: true, card };
  });
}

// ---------------------------------------------------------------------------
// QUICK UPDATE — the dictation field
// ---------------------------------------------------------------------------

const QuickUpdateInput = z.object({
  accountId: z.string().uuid(),
  body: z.string().min(2).max(4000),
});

export async function quickUpdateAction(input: {
  accountId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const parsed = QuickUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Say or type a little more first." };
  const { accountId, body } = parsed.data;

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ id: accounts.id, territory: accounts.territory })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!acct) return { ok: false, error: "Lead not found" };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "You don't have access to that lead." };
    }

    await tx.insert(activities).values({
      accountId,
      type: "visit",
      direction: "na",
      subject: "Field update",
      body: body.trim(),
      ownerUserId: session.sub,
    });
    await tx
      .update(accounts)
      .set({ updatedAt: sql`now()` })
      .where(eq(accounts.id, accountId));

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// STAGE CHANGE — delegates to the existing kanban/convert actions
// ---------------------------------------------------------------------------

const StageInput = z.object({
  accountId: z.string().uuid(),
  stage: z.enum([
    "new_lead",
    "contacted",
    "proposal",
    "negotiation",
    "closed_won",
    "closed_lost",
  ]),
});

export async function setFieldStageAction(input: {
  accountId: string;
  stage: DbStage;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = StageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid stage" };
  const { accountId, stage } = parsed.data;

  if (stage === "closed_won") {
    // Won in Field Mode == "it's in Symphony now" == the lead is a customer.
    // convertLeadAction sets status=customer + stage=closed_won + audit note.
    const res = await convertLeadAction({ accountId });
    return { ok: res.ok, error: res.error };
  }

  const res = await moveLeadStageAction({ accountId, stage });
  return { ok: res.ok, error: res.error };
}

// ---------------------------------------------------------------------------
// WEEKLY FIELD REPORT — milestones by rep + team changelog
// ---------------------------------------------------------------------------
//
// Milestone counts come from the audit notes moveLeadStageAction writes
// ("Funnel stage → proposal") plus convertLeadAction's "Converted to
// customer" — meaning the report reflects what actually happened this week,
// not just current stock. Changelog = every field update / note this week.

export type FieldReport = {
  weekStartIso: string;
  weekEndIso: string;
  reps: {
    name: string;
    contacted: number;
    quoted: number;
    scheduled: number;
    won: number;
    updates: number;
  }[];
  changelog: {
    occurredAt: string;
    ownerName: string;
    companyName: string;
    body: string;
  }[];
  pipeline: { stage: string; count: number }[];
};

export async function getFieldReportAction(): Promise<{
  ok: boolean;
  report?: FieldReport;
  error?: string;
}> {
  const session = await requireSession();

  // Trailing 7 days, aligned to "now" — simple and predictable on a phone.
  const weekEnd = new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  return withSession(session, async (tx) => {
    const rows = await tx
      .select({
        subject: activities.subject,
        body: activities.body,
        type: activities.type,
        occurredAt: activities.occurredAt,
        firstName: users.firstName,
        lastName: users.lastName,
        companyName: accounts.companyName,
      })
      .from(activities)
      .innerJoin(accounts, eq(accounts.id, activities.accountId))
      .leftJoin(users, eq(users.id, activities.ownerUserId))
      .where(
        and(
          gte(activities.occurredAt, weekStart),
          isNull(accounts.deletedAt),
          territoryFilter(session.territory)
            ? territoryFilter(session.territory)
            : undefined,
        ),
      )
      .orderBy(desc(activities.occurredAt))
      .limit(500);

    const repMap = new Map<
      string,
      { name: string; contacted: number; quoted: number; scheduled: number; won: number; updates: number }
    >();
    const changelog: FieldReport["changelog"] = [];

    for (const r of rows) {
      const name = r.firstName ? `${r.firstName}` : "Team";
      if (!repMap.has(name)) {
        repMap.set(name, { name, contacted: 0, quoted: 0, scheduled: 0, won: 0, updates: 0 });
      }
      const rep = repMap.get(name)!;
      const subj = r.subject ?? "";

      if (subj.startsWith("Funnel stage →")) {
        if (subj.includes("contacted") || subj.includes("qualified")) rep.contacted++;
        else if (subj.includes("proposal")) rep.quoted++;
        else if (subj.includes("negotiation")) rep.scheduled++;
        else if (subj.includes("closed_won")) rep.won++;
      } else if (subj === "Converted to customer") {
        rep.won++;
      } else if (r.type === "visit" || r.type === "note" || r.type === "call" || r.type === "meeting") {
        rep.updates++;
        if (r.body && changelog.length < 60) {
          changelog.push({
            occurredAt: r.occurredAt.toISOString(),
            ownerName: name,
            companyName: r.companyName,
            body: r.body,
          });
        }
      }
    }

    // Current pipeline stock (open stages only).
    const stock = await tx
      .select({
        stage: accounts.salesFunnelStage,
        count: sql<number>`count(*)::int`,
      })
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          eq(accounts.accountStatus, "prospect"),
          territoryFilter(session.territory),
          inArray(accounts.salesFunnelStage, [
            "contacted",
            "qualified",
            "proposal",
            "negotiation",
          ]),
        ),
      )
      .groupBy(accounts.salesFunnelStage);

    return {
      ok: true,
      report: {
        weekStartIso: weekStart.toISOString(),
        weekEndIso: weekEnd.toISOString(),
        reps: Array.from(repMap.values()).sort(
          (a, b) =>
            b.won - a.won ||
            b.scheduled - a.scheduled ||
            b.quoted - a.quoted ||
            b.updates - a.updates,
        ),
        changelog,
        pipeline: stock.map((s) => ({ stage: s.stage, count: s.count })),
      },
    };
  });
}
