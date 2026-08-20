// Field Mode routes — /api/field/*
// Phone-first sales view: lead list/search, lead detail, quick update,
// contact upsert, stage move, 7-day report, Symphony CSV export.

import { Router, type IRouter } from "express";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { accounts, activities, contacts, users } from "@workspace/db";
import {
  GetFieldLeadsQueryParams,
  GetFieldLeadsResponse,
  GetFieldLeadResponse,
  PostFieldLeadUpdateBody,
  PostFieldLeadUpdateResponse,
  UpsertFieldLeadContactBody,
  UpsertFieldLeadContactResponse,
  SetFieldLeadStageBody,
  SetFieldLeadStageResponse,
  GetFieldReportResponse,
  GetFieldSymphonyExportQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middlewares/requireAuth";
import { withSession } from "../../lib/withSession";
import type { SessionClaims } from "../../lib/auth";

const router: IRouter = Router();

// All field routes require bearer auth.
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Territory filter helper (mirrors field/actions.ts)
// ---------------------------------------------------------------------------

function territoryWhere(territory: string) {
  if (territory === "both") return undefined;
  return or(
    eq(accounts.territory, territory as "fun_coast" | "space_coast"),
    eq(accounts.territory, "unassigned"),
  );
}

// ---------------------------------------------------------------------------
// GET /field/leads?search=
// ---------------------------------------------------------------------------

router.get("/field/leads", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;
  const query = GetFieldLeadsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search } = query.data;

  const result = await withSession(session, async (tx) => {
    if (search && search.trim().length >= 2) {
      // Search mode — reach the full lead universe, cap at 30.
      const q = `%${search.trim()}%`;
      return tx
        .select({
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
        })
        .from(accounts)
        .where(
          and(
            isNull(accounts.deletedAt),
            eq(accounts.accountStatus, "prospect"),
            territoryWhere(session.territory),
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
    }

    // Default list — "worked" leads (not new_lead stage), up to 400.
    return tx
      .select({
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
      })
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          eq(accounts.accountStatus, "prospect"),
          territoryWhere(session.territory),
        ),
      )
      .orderBy(desc(accounts.updatedAt))
      .limit(400);
  });

  res.json(
    GetFieldLeadsResponse.parse({
      rows: result.map((r) => ({
        ...r,
        stageChangedAt: r.stageChangedAt.toISOString(),
        lastActivityAt: null,
        lastActivityBody: null,
        ownerFirstName: null,
      })),
    }),
  );
});

// ---------------------------------------------------------------------------
// GET /field/leads/:id
// ---------------------------------------------------------------------------

router.get("/field/leads/:id", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const result = await withSession(session, async (tx) => {
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, rawId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return null;

    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return "forbidden" as const;
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
      .where(and(eq(contacts.accountId, rawId), isNull(contacts.deletedAt)))
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
      .where(eq(activities.accountId, rawId))
      .orderBy(desc(activities.occurredAt))
      .limit(25);

    return {
      id: acct.id,
      companyName: acct.companyName,
      dbaName: acct.dbaName ?? null,
      addressLine1: acct.addressLine1 ?? null,
      city: acct.city ?? null,
      state: acct.state ?? null,
      zip: acct.zip ?? null,
      county: acct.county ?? null,
      territory: acct.territory,
      phone: acct.phone ?? null,
      phoneRaw: acct.phoneRaw ?? null,
      website: acct.website ?? null,
      fryerCount: acct.fryerCount ?? null,
      stage: acct.salesFunnelStage,
      stageChangedAt: acct.salesFunnelStageChangedAt.toISOString(),
      accountStatus: acct.accountStatus,
      ncaFlag: acct.ncaFlag,
      ncaName: acct.ncaName ?? null,
      leadSource: acct.leadSource,
      filtaRecordId: acct.filtaRecordId ?? null,
      notes: acct.notes ?? null,
      primaryContact: contactRows[0]
        ? {
            fullName: contactRows[0].fullName ?? null,
            title: contactRows[0].title ?? null,
            email: contactRows[0].email ?? null,
            phoneMobile: contactRows[0].phoneMobile ?? null,
            phoneDirect: contactRows[0].phoneDirect ?? null,
          }
        : null,
      feed: feedRows.map((f) => ({
        id: f.id,
        type: f.type,
        subject: f.subject ?? null,
        body: f.body ?? null,
        occurredAt: f.occurredAt.toISOString(),
        ownerName: f.firstName ? `${f.firstName} ${f.lastName ?? ""}`.trim() : null,
      })),
    };
  });

  if (result === null) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (result === "forbidden") {
    res.status(403).json({ error: "You don't have access to that lead." });
    return;
  }

  res.json(GetFieldLeadResponse.parse(result));
});

// ---------------------------------------------------------------------------
// POST /field/leads/:id/updates
// ---------------------------------------------------------------------------

router.post("/field/leads/:id/updates", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = PostFieldLeadUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { body } = parsed.data;

  const result = await withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ id: accounts.id, territory: accounts.territory })
      .from(accounts)
      .where(and(eq(accounts.id, rawId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!acct) return "not_found" as const;
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return "forbidden" as const;
    }

    await tx.insert(activities).values({
      accountId: rawId,
      type: "visit",
      direction: "na",
      subject: "Field update",
      body: body.trim(),
      ownerUserId: session.sub,
    });
    await tx
      .update(accounts)
      .set({ updatedAt: sql`now()` })
      .where(eq(accounts.id, rawId));

    return "ok" as const;
  });

  if (result === "not_found") {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (result === "forbidden") {
    res.status(403).json({ error: "You don't have access to that lead." });
    return;
  }

  res.json(PostFieldLeadUpdateResponse.parse({ ok: true }));
});

// ---------------------------------------------------------------------------
// PUT /field/leads/:id/contact
// ---------------------------------------------------------------------------

router.put("/field/leads/:id/contact", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = UpsertFieldLeadContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { fullName, email } = parsed.data;

  const result = await withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ id: accounts.id, territory: accounts.territory })
      .from(accounts)
      .where(and(eq(accounts.id, rawId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!acct) return "not_found" as const;
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return "forbidden" as const;
    }

    // Find existing primary contact.
    const [existing] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.accountId, rawId),
          eq(contacts.isPrimary, true),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(contacts)
        .set({
          fullName,
          email: email ?? null,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, existing.id));
    } else {
      await tx.insert(contacts).values({
        accountId: rawId,
        fullName,
        email: email ?? null,
        isPrimary: true,
      });
    }

    await tx
      .update(accounts)
      .set({ updatedAt: sql`now()` })
      .where(eq(accounts.id, rawId));

    return "ok" as const;
  });

  if (result === "not_found") {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (result === "forbidden") {
    res.status(403).json({ error: "You don't have access to that lead." });
    return;
  }

  res.json(UpsertFieldLeadContactResponse.parse({ ok: true }));
});

// ---------------------------------------------------------------------------
// POST /field/leads/:id/stage
// ---------------------------------------------------------------------------

router.post("/field/leads/:id/stage", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = SetFieldLeadStageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { stage } = parsed.data;

  const result = await withSession(session, async (tx) => {
    const [acct] = await tx
      .select({
        id: accounts.id,
        territory: accounts.territory,
        currentStage: accounts.salesFunnelStage,
        accountStatus: accounts.accountStatus,
        companyName: accounts.companyName,
      })
      .from(accounts)
      .where(and(eq(accounts.id, rawId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return "not_found" as const;
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return "forbidden" as const;
    }

    if (stage === "closed_won") {
      // Won in Field Mode = convert to customer (mirrors convertLeadAction).
      if (acct.accountStatus === "customer") return "ok" as const;
      if (acct.accountStatus !== "prospect") {
        return { error: `Cannot convert ${acct.accountStatus} account` } as const;
      }

      const now = new Date();
      await tx
        .update(accounts)
        .set({
          accountStatus: "customer",
          salesFunnelStage: "closed_won",
          salesFunnelStageChangedAt: now,
          convertedAt: now,
          updatedAt: now,
        })
        .where(eq(accounts.id, rawId));

      await tx.insert(activities).values({
        accountId: rawId,
        type: "note",
        direction: "na",
        subject: "Converted to customer",
        body: `${acct.companyName} converted from prospect to customer.`,
        ownerUserId: session.sub,
      });

      return "ok" as const;
    }

    // Regular stage move (mirrors moveLeadStageAction).
    if (acct.accountStatus !== "prospect") {
      return {
        error: `Lead is no longer a prospect (status: ${acct.accountStatus})`,
      } as const;
    }
    if (acct.currentStage === stage) return "ok" as const;

    const now = new Date();
    await tx
      .update(accounts)
      .set({
        salesFunnelStage: stage,
        salesFunnelStageChangedAt: now,
        updatedAt: now,
      })
      .where(eq(accounts.id, rawId));

    // Audit note (mirrors moveLeadStageAction behavior).
    await tx.insert(activities).values({
      accountId: rawId,
      type: "note",
      direction: "na",
      subject: `Funnel stage → ${stage}`,
      body: `Stage changed to ${stage}.`,
      ownerUserId: session.sub,
    });

    return "ok" as const;
  });

  if (result === "not_found") {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (result === "forbidden") {
    res.status(403).json({ error: "You don't have access to that lead." });
    return;
  }
  if (typeof result === "object" && "error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json(SetFieldLeadStageResponse.parse({ ok: true }));
});

// ---------------------------------------------------------------------------
// GET /field/report
// ---------------------------------------------------------------------------

router.get("/field/report", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;

  const weekEnd = new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const report = await withSession(session, async (tx) => {
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
          territoryWhere(session.territory),
        ),
      )
      .orderBy(desc(activities.occurredAt))
      .limit(500);

    const repMap = new Map<
      string,
      {
        name: string;
        contacted: number;
        quoted: number;
        scheduled: number;
        won: number;
        updates: number;
      }
    >();
    const changelog: Array<{
      occurredAt: string;
      ownerName: string;
      companyName: string;
      body: string;
    }> = [];

    for (const r of rows) {
      const name = r.firstName ? `${r.firstName}` : "Team";
      if (!repMap.has(name)) {
        repMap.set(name, {
          name,
          contacted: 0,
          quoted: 0,
          scheduled: 0,
          won: 0,
          updates: 0,
        });
      }
      const rep = repMap.get(name)!;
      const subj = r.subject ?? "";

      if (subj.startsWith("Funnel stage →")) {
        if (subj.includes("contacted") || subj.includes("qualified"))
          rep.contacted++;
        else if (subj.includes("proposal")) rep.quoted++;
        else if (subj.includes("negotiation")) rep.scheduled++;
        else if (subj.includes("closed_won")) rep.won++;
      } else if (subj === "Converted to customer") {
        rep.won++;
      } else if (
        r.type === "visit" ||
        r.type === "note" ||
        r.type === "call" ||
        r.type === "meeting"
      ) {
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
          territoryWhere(session.territory),
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
    };
  });

  res.json(GetFieldReportResponse.parse(report));
});

// ---------------------------------------------------------------------------
// GET /field/symphony-export?stage=scheduled|won
// ---------------------------------------------------------------------------

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const raw = String(v);
  const s = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

router.get("/field/symphony-export", async (req, res): Promise<void> => {
  const session = req.session as SessionClaims;
  const qp = GetFieldSymphonyExportQueryParams.safeParse(req.query);
  const mode = qp.success && qp.data.stage === "won" ? "won" : "scheduled";

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await withSession(session, async (tx) => {
    return tx
      .select({
        filtaRecordId: accounts.filtaRecordId,
        companyName: accounts.companyName,
        addressLine1: accounts.addressLine1,
        city: accounts.city,
        state: accounts.state,
        zip: accounts.zip,
        county: accounts.county,
        territory: accounts.territory,
        phoneRaw: accounts.phoneRaw,
        phone: accounts.phone,
        website: accounts.website,
        fryerCount: accounts.fryerCount,
        ncaFlag: accounts.ncaFlag,
        ncaName: accounts.ncaName,
        stageChangedAt: accounts.salesFunnelStageChangedAt,
        contactName: contacts.fullName,
        contactEmail: contacts.email,
        contactMobile: contacts.phoneMobile,
      })
      .from(accounts)
      .leftJoin(
        contacts,
        and(
          eq(contacts.accountId, accounts.id),
          eq(contacts.isPrimary, true),
          isNull(contacts.deletedAt),
        ),
      )
      .where(
        and(
          isNull(accounts.deletedAt),
          mode === "scheduled"
            ? and(
                eq(accounts.accountStatus, "prospect"),
                eq(accounts.salesFunnelStage, "negotiation"),
              )
            : and(
                eq(accounts.accountStatus, "customer"),
                gte(accounts.convertedAt, thirtyDaysAgo),
              ),
          territoryWhere(session.territory),
        ),
      )
      .orderBy(desc(accounts.salesFunnelStageChangedAt))
      .limit(500);
  });

  const header = [
    "Record ID",
    "Company",
    "Contact",
    "City",
    "Phone",
    "Fryers",
    "Sales Funnel",
    "NCA",
    "Street Address",
    "State",
    "Zip",
    "County",
    "Territory",
    "Website",
    "Contact Email",
    "Contact Mobile",
    "Stage Date",
  ];

  const funnelLabel = mode === "scheduled" ? "Completed Meeting" : "Customer";

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.filtaRecordId),
        csvCell(r.companyName),
        csvCell(r.contactName),
        csvCell(r.city),
        csvCell(formatPhone(r.phoneRaw ?? r.phone)),
        csvCell(r.fryerCount),
        csvCell(funnelLabel),
        csvCell(r.ncaFlag ? (r.ncaName ?? "Yes") : ""),
        csvCell(r.addressLine1),
        csvCell(r.state),
        csvCell(r.zip),
        csvCell(r.county),
        csvCell(
          r.territory === "fun_coast"
            ? "Fun Coast"
            : r.territory === "space_coast"
              ? "Space Coast"
              : "Unassigned",
        ),
        csvCell(r.website),
        csvCell(r.contactEmail),
        csvCell(r.contactMobile),
        csvCell(r.stageChangedAt.toISOString().slice(0, 10)),
      ].join(","),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="symphony_${mode}_${today}.csv"`,
  );
  res.send(lines.join("\n"));
});

export default router;
