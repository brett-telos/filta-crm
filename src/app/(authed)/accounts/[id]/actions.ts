"use server";

// Server actions for the account detail page.
// - logActivityAction: append to the activity timeline
// - updateAccountAction: status + notes (kept for back-compat)
// - updateAccountInfoAction: editable contact / address / company info
// - updateServiceProfileAction: editable services JSONB
// - upsertContactAction: add or edit a contact
// - deleteContactAction: soft-delete a contact

import { desc, eq, and, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  activities,
  contacts,
  emailSends,
  messageTemplates,
  opportunities,
  users,
  withSession,
} from "@/db";
import { requireSession } from "@/lib/session";
import { normalizePhoneE164 } from "@/lib/format";
import { sendEmail } from "@/lib/resend";
import {
  renderTemplate,
  replyAddressFor,
  senderIdentityFor,
  wrapInBaseHtml,
} from "@/lib/email-templates";

// ---------- log activity ----------------------------------------------------

const LogInput = z.object({
  accountId: z.string().uuid(),
  type: z.enum(["call", "email", "meeting", "visit", "note", "task"]),
  direction: z.enum(["inbound", "outbound", "na"]).optional(),
  disposition: z
    .enum([
      "connected",
      "left_voicemail",
      "no_answer",
      "wrong_number",
      "number_disconnected",
      "line_busy",
      "not_interested",
      "dnc",
      "callback_scheduled",
      "meeting_booked",
      "site_eval_booked",
      "demo_booked",
      "dm_unavailable",
      "language_barrier",
      "corporate_decision",
      "chain_decision",
      "not_qualified",
      "other",
    ])
    .optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
  durationMinutes: z
    .string()
    .optional()
    .transform((v) => (v && v.length ? Number(v) : undefined))
    .pipe(z.number().int().min(0).max(600).optional()),
});

export type LogState = {
  error?: string;
  ok?: boolean;
};

export async function logActivityAction(
  _prev: LogState,
  formData: FormData,
): Promise<LogState> {
  const session = await requireSession();

  const parsed = LogInput.safeParse({
    accountId: formData.get("accountId"),
    type: formData.get("type"),
    direction: formData.get("direction") || undefined,
    disposition: formData.get("disposition") || undefined,
    subject: formData.get("subject") || undefined,
    body: formData.get("body") || undefined,
    durationMinutes: formData.get("durationMinutes") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const { accountId, type, direction, disposition, subject, body, durationMinutes } =
    parsed.data;

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({
        id: accounts.id,
        territory: accounts.territory,
        deletedAt: accounts.deletedAt,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);

    if (!acct || acct.deletedAt) {
      return { error: "Account not found." };
    }
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { error: "You don't have access to that account." };
    }

    await tx.insert(activities).values({
      accountId,
      type,
      direction: direction ?? "na",
      disposition,
      subject: subject?.trim() || undefined,
      body: body?.trim() || undefined,
      durationMinutes,
      ownerUserId: session.sub,
    });

    await tx
      .update(accounts)
      .set({ updatedAt: sql`now()` })
      .where(eq(accounts.id, accountId));

    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  });
}

// ---------- update account status -------------------------------------------
//
// Notes are now logged as activity rows (type='note') via logActivityAction —
// each save becomes its own timestamped, attributed entry in the timeline,
// and the textarea clears after submission. The single accounts.notes column
// is kept for legacy display only.

const StatusInput = z.object({
  accountId: z.string().uuid(),
  accountStatus: z.enum(["prospect", "customer", "churned", "do_not_contact"]),
});

export type AccountStatusState = {
  ok?: boolean;
  error?: string;
};

export async function updateAccountStatusAction(
  _prev: AccountStatusState,
  formData: FormData,
): Promise<AccountStatusState> {
  const session = await requireSession();
  const parsed = StatusInput.safeParse({
    accountId: formData.get("accountId"),
    accountStatus: formData.get("accountStatus"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.accountId))
      .limit(1);

    if (!acct || acct.deletedAt) {
      return { error: "Account not found." };
    }
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { error: "You don't have access to that account." };
    }

    await tx
      .update(accounts)
      .set({
        accountStatus: parsed.data.accountStatus,
        updatedAt: sql`now()`,
      })
      .where(eq(accounts.id, parsed.data.accountId));

    revalidatePath(`/accounts/${parsed.data.accountId}`);
    return { ok: true };
  });
}

// ---------- editable contact info / address ---------------------------------

const optStr = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim().length ? v.trim() : null));

const AccountInfoInput = z.object({
  accountId: z.string().uuid(),
  companyName: z.string().min(1, "Company name is required").max(200),
  dbaName: optStr(200),
  addressLine1: optStr(200),
  addressLine2: optStr(200),
  city: optStr(80),
  state: optStr(20),
  zip: optStr(20),
  county: optStr(80),
  phone: optStr(40),
  website: optStr(200),
  industrySegment: z
    .enum([
      "restaurant",
      "yacht_club",
      "hotel",
      "school_university",
      "healthcare",
      "corporate_dining",
      "senior_living",
      "aerospace_defense",
      "entertainment_venue",
      "government_military",
      "other",
    ])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  leadSource: z.enum([
    "filta_corporate",
    "referral",
    "web",
    "trade_show",
    "cold_outbound",
    "existing_customer",
    "other",
  ]),
  fryerCount: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length ? Number(v) : null))
    .pipe(z.number().int().min(0).max(500).nullable()),
  ncaFlag: z
    .union([z.literal("on"), z.literal("true"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
  ncaName: optStr(120),
});

export type AccountInfoState = { ok?: boolean; error?: string };

export async function updateAccountInfoAction(
  _prev: AccountInfoState,
  formData: FormData,
): Promise<AccountInfoState> {
  const session = await requireSession();

  const parsed = AccountInfoInput.safeParse({
    accountId: formData.get("accountId"),
    companyName: formData.get("companyName"),
    dbaName: formData.get("dbaName") ?? "",
    addressLine1: formData.get("addressLine1") ?? "",
    addressLine2: formData.get("addressLine2") ?? "",
    city: formData.get("city") ?? "",
    state: formData.get("state") ?? "",
    zip: formData.get("zip") ?? "",
    county: formData.get("county") ?? "",
    phone: formData.get("phone") ?? "",
    website: formData.get("website") ?? "",
    industrySegment: formData.get("industrySegment") || undefined,
    leadSource: formData.get("leadSource"),
    fryerCount: formData.get("fryerCount") ?? "",
    ncaFlag: formData.get("ncaFlag") ?? "",
    ncaName: formData.get("ncaName") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const d = parsed.data;
  const phoneRaw = d.phone;
  const phoneE164 = normalizePhoneE164(d.phone);

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, d.accountId))
      .limit(1);
    if (!acct || acct.deletedAt) return { error: "Account not found." };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { error: "You don't have access to that account." };
    }

    await tx
      .update(accounts)
      .set({
        companyName: d.companyName,
        dbaName: d.dbaName,
        addressLine1: d.addressLine1,
        addressLine2: d.addressLine2,
        city: d.city,
        state: d.state ?? "FL",
        zip: d.zip,
        county: d.county,
        phone: phoneE164,
        phoneRaw,
        website: d.website,
        industrySegment: d.industrySegment ?? null,
        leadSource: d.leadSource,
        fryerCount: d.fryerCount,
        ncaFlag: d.ncaFlag,
        ncaName: d.ncaFlag ? d.ncaName : null,
        updatedAt: sql`now()`,
      })
      .where(eq(accounts.id, d.accountId));

    revalidatePath(`/accounts/${d.accountId}`);
    return { ok: true };
  });
}

// ---------- editable service profile ---------------------------------------

const SERVICE_KEYS = ["ff", "fs", "fb", "fg", "fc", "fd"] as const;

export type ServiceProfileState = { ok?: boolean; error?: string };

export async function updateServiceProfileAction(
  _prev: ServiceProfileState,
  formData: FormData,
): Promise<ServiceProfileState> {
  const session = await requireSession();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Missing account." };

  // Build the new service_profile JSONB from posted form fields.
  const sp: Record<string, any> = {};
  for (const k of SERVICE_KEYS) {
    const active = formData.get(`svc_${k}_active`) === "on";
    const revRaw = String(formData.get(`svc_${k}_revenue`) ?? "").trim();
    const lastRaw = String(formData.get(`svc_${k}_last`) ?? "").trim();
    const entry: Record<string, any> = { active };
    if (revRaw.length) {
      const n = Number(revRaw);
      if (!Number.isFinite(n) || n < 0) {
        return { error: `Invalid monthly revenue for ${k.toUpperCase()}.` };
      }
      entry.monthly_revenue = n;
    }
    if (lastRaw.length) {
      // Accept YYYY-MM-DD from <input type="date">
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastRaw)) {
        return { error: `Invalid last service date for ${k.toUpperCase()}.` };
      }
      entry.last_service_date = lastRaw;
    }
    sp[k] = entry;
  }

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!acct || acct.deletedAt) return { error: "Account not found." };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { error: "You don't have access to that account." };
    }

    await tx
      .update(accounts)
      .set({ serviceProfile: sp, updatedAt: sql`now()` })
      .where(eq(accounts.id, accountId));

    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  });
}

// ---------- contacts: upsert + delete --------------------------------------

const ContactInput = z.object({
  accountId: z.string().uuid(),
  contactId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  firstName: optStr(80),
  lastName: optStr(80),
  title: optStr(120),
  email: optStr(200),
  phoneDirect: optStr(40),
  phoneMobile: optStr(40),
  decisionMakerRole: z
    .enum(["economic_buyer", "champion", "user", "blocker", "unknown"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  preferredChannel: z
    .enum(["email", "phone", "text", "in_person"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  isPrimary: z
    .union([z.literal("on"), z.literal("true"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export type ContactState = { ok?: boolean; error?: string };

export async function upsertContactAction(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const session = await requireSession();

  const parsed = ContactInput.safeParse({
    accountId: formData.get("accountId"),
    contactId: formData.get("contactId") ?? "",
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    title: formData.get("title") ?? "",
    email: formData.get("email") ?? "",
    phoneDirect: formData.get("phoneDirect") ?? "",
    phoneMobile: formData.get("phoneMobile") ?? "",
    decisionMakerRole: formData.get("decisionMakerRole") || undefined,
    preferredChannel: formData.get("preferredChannel") || undefined,
    isPrimary: formData.get("isPrimary") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const d = parsed.data;
  const fullName =
    [d.firstName ?? "", d.lastName ?? ""].join(" ").trim() || null;
  const phoneDirect = normalizePhoneE164(d.phoneDirect);
  const phoneMobile = normalizePhoneE164(d.phoneMobile);

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, d.accountId))
      .limit(1);
    if (!acct || acct.deletedAt) return { error: "Account not found." };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { error: "You don't have access to that account." };
    }

    // Only one primary per account — if this row is being marked primary,
    // unmark any existing primary first.
    if (d.isPrimary) {
      await tx
        .update(contacts)
        .set({ isPrimary: false, updatedAt: sql`now()` })
        .where(eq(contacts.accountId, d.accountId));
    }

    if (d.contactId) {
      await tx
        .update(contacts)
        .set({
          firstName: d.firstName,
          lastName: d.lastName,
          fullName,
          title: d.title,
          email: d.email,
          phoneDirect,
          phoneMobile,
          decisionMakerRole: d.decisionMakerRole ?? null,
          preferredChannel: d.preferredChannel ?? null,
          isPrimary: d.isPrimary,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(contacts.id, d.contactId), eq(contacts.accountId, d.accountId)),
        );
    } else {
      await tx.insert(contacts).values({
        accountId: d.accountId,
        firstName: d.firstName,
        lastName: d.lastName,
        fullName,
        title: d.title,
        email: d.email,
        phoneDirect,
        phoneMobile,
        decisionMakerRole: d.decisionMakerRole ?? "unknown",
        preferredChannel: d.preferredChannel ?? null,
        isPrimary: d.isPrimary,
      });
    }

    revalidatePath(`/accounts/${d.accountId}`);
    return { ok: true };
  });
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const accountId = String(formData.get("accountId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!accountId || !contactId) return;

  await withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!acct || acct.deletedAt) return;
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return;
    }

    await tx
      .update(contacts)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(eq(contacts.id, contactId), eq(contacts.accountId, accountId)),
      );

    revalidatePath(`/accounts/${accountId}`);
  });
}


// ============================================================================
// AD-HOC EMAIL SEND (account composer modal)
// ============================================================================
//
// Lets a rep fire a quick email from /accounts/[id] without leaving the
// app — same Resend pipeline as the cross-sell + quote flows, so the send
// shows up on the "Emails sent" card and gets engagement tracking.
//
// Three-phase pattern (TX1 snapshot + queue → network → TX2 finalize +
// activity), matching sendQuoteAction / sendFsCrossSellEmailAction.
//
// Templates: optional. If a templateId is passed we render its subject +
// body templates with the standard vars (firstName, companyName, etc.).
// If omitted, the user's plain text body is wrapped in <p> tags and then
// in the branded shell.

const AdHocEmailInput = z.object({
  accountId: z.string().uuid(),
  contactId: z.string().uuid(),
  /** Optional — when set, prefill the action with the template's content. */
  templateId: z.string().uuid().optional().nullable(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10000),
});

export type SendAdHocEmailResult = {
  ok: boolean;
  error?: string;
  emailSendId?: string;
  devStub?: boolean;
};

/**
 * Convert plain-text body into HTML by wrapping each non-empty paragraph
 * in <p>. Preserves single line breaks within a paragraph as <br>.
 * Trivial enough that pulling in a Markdown library would be overkill.
 */
function plainToHtml(plain: string): string {
  return plain
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendAdHocAccountEmailAction(
  input: z.infer<typeof AdHocEmailInput>,
): Promise<SendAdHocEmailResult> {
  const session = await requireSession();
  const parsed = AdHocEmailInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "Invalid input",
    };
  }
  const { accountId, contactId, templateId, subject, body } = parsed.data;

  // ---- TX1: validate, snapshot, queue ----------------------------------
  const prep = await withSession(session, async (tx) => {
    const [acct] = await tx
      .select({
        id: accounts.id,
        companyName: accounts.companyName,
        territory: accounts.territory,
        deletedAt: accounts.deletedAt,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!acct || acct.deletedAt) {
      return { kind: "error" as const, error: "Account not found" };
    }
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { kind: "error" as const, error: "Access denied" };
    }

    const [contact] = await tx
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        fullName: contacts.fullName,
        email: contacts.email,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.accountId, accountId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!contact || !contact.email) {
      return {
        kind: "error" as const,
        error: "Contact has no email on file",
      };
    }

    // Optional template prefill — caller already substituted vars on the
    // client side when picking the template, so we treat the incoming
    // subject + body as the FINAL content. We only look up the template
    // here to record templateId on the email_sends row.
    let templateRow:
      | { id: string }
      | undefined = undefined;
    if (templateId) {
      const [t] = await tx
        .select({ id: messageTemplates.id })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.id, templateId),
            eq(messageTemplates.active, true),
          ),
        )
        .limit(1);
      if (t) templateRow = { id: t.id };
    }

    // Sender + variable substitution. We allow placeholders like
    // {{firstName}} / {{companyName}} / {{senderFirstName}} in the body
    // even when the rep types it freeform — matches the rep's mental
    // model from the seeded templates.
    const sender = senderIdentityFor(acct.territory);
    const [sendingUser] = await tx
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, session.sub))
      .limit(1);
    const vars = {
      firstName:
        contact.firstName && contact.firstName.trim().length > 0
          ? contact.firstName.trim()
          : "there",
      companyName: acct.companyName,
      senderFirstName: sendingUser?.firstName ?? sender.fromName,
      senderFullName: sendingUser
        ? `${sendingUser.firstName} ${sendingUser.lastName}`.trim()
        : sender.fromName,
      territoryLabel: sender.territoryLabel,
    };

    const renderedSubject = renderTemplate(subject, vars);
    const bodyAsHtmlFragment = plainToHtml(renderTemplate(body, vars));
    const renderedHtml = wrapInBaseHtml({
      territory: acct.territory,
      contentHtml: bodyAsHtmlFragment,
      preheader: renderedSubject,
    });
    const renderedText = renderTemplate(body, vars);

    // Snapshot the queued send.
    const [send] = await tx
      .insert(emailSends)
      .values({
        accountId: acct.id,
        contactId: contact.id,
        opportunityId: null,
        templateId: templateRow?.id ?? null,
        fromEmail: sender.fromEmail,
        fromName: sender.fromName,
        toEmail: contact.email,
        subject: renderedSubject,
        bodyHtml: renderedHtml,
        bodyText: renderedText,
        status: "queued",
        sentByUserId: session.sub,
      })
      .returning({ id: emailSends.id });

    return {
      kind: "ready" as const,
      emailSendId: send.id,
      accountId: acct.id,
      toEmail: contact.email,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo:
        process.env.EMAIL_REPLY_TO ||
        replyAddressFor(acct.territory, send.id),
    };
  });

  if (prep.kind === "error") return { ok: false, error: prep.error };

  // ---- network ---------------------------------------------------------
  const sendResult = await sendEmail({
    from: prep.fromEmail,
    fromName: prep.fromName,
    to: prep.toEmail,
    subject: prep.subject,
    html: prep.html,
    text: prep.text,
    replyTo: prep.replyTo,
    tags: [{ name: "campaign", value: "adhoc_account" }],
  });

  // ---- TX2: finalize + activity ---------------------------------------
  await withSession(session, async (tx) => {
    if (!sendResult.ok) {
      await tx
        .update(emailSends)
        .set({ status: "failed", providerError: sendResult.error })
        .where(eq(emailSends.id, prep.emailSendId));
      return;
    }
    await tx
      .update(emailSends)
      .set({
        status: "sent",
        providerMessageId: sendResult.providerMessageId,
        sentAt: new Date(),
      })
      .where(eq(emailSends.id, prep.emailSendId));

    await tx.insert(activities).values({
      accountId: prep.accountId,
      type: "email",
      direction: "outbound",
      subject: `Sent: ${prep.subject}`,
      body: `Ad-hoc email sent to ${prep.toEmail}.`,
      ownerUserId: session.sub,
    });
  });

  revalidatePath(`/accounts/${prep.accountId}`);

  if (!sendResult.ok) {
    return {
      ok: false,
      error: sendResult.error,
      emailSendId: prep.emailSendId,
    };
  }
  return {
    ok: true,
    emailSendId: prep.emailSendId,
    devStub: sendResult.devStub,
  };
}

// Touch unused imports so they're not pruned by editors.
void desc;
void opportunities;
