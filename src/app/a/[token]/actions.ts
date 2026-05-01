"use server";

// Public sign action for /a/[token]. Token-authed, no CRM session.
//
// On submit:
//   - Validates token + name
//   - Captures IP and user-agent for audit
//   - Stamps customer_signed_at + customer_signed_name on the agreement
//   - Transitions agreement.status to 'signed'
//   - Writes a 'Customer signed agreement' activity for the rep timeline
//   - Sends a confirmation email back to the customer

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  accounts,
  activities,
  emailSends,
  opportunities,
  quoteVersions,
  serviceAgreements,
  users,
} from "@/db";
import { sendEmail } from "@/lib/resend";
import { senderIdentityFor, wrapInBaseHtml } from "@/lib/email-templates";
import { loadAgreementByToken } from "@/lib/public-tokens";

const Input = z.object({
  token: z.string().min(10),
  signedName: z.string().trim().min(2).max(200),
});

export type SignResult = { ok: boolean; error?: string };

export async function signAgreementPublicAction(
  input: z.infer<typeof Input>,
): Promise<SignResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const agreement = await loadAgreementByToken(parsed.data.token);
  if (!agreement) {
    return {
      ok: false,
      error: "This link has expired or is no longer valid",
    };
  }
  if (agreement.customerSignedAt) {
    // Idempotent — already signed is a no-op success.
    return { ok: true };
  }
  if (agreement.status === "terminated") {
    return { ok: false, error: "This agreement has been terminated" };
  }

  // Capture the request audit context. headers() is sync in route handlers
  // and server actions in this Next.js version.
  const hdrs = headers();
  const fwd = hdrs.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "unknown";
  const userAgent = hdrs.get("user-agent") || "unknown";

  // Pull the customer/rep context for the confirmation email + activity.
  const [meta] = await db
    .select({
      accountId: serviceAgreements.accountId,
      opportunityId: quoteVersions.opportunityId,
      accountTerritory: accounts.territory,
      customerCompanyName: quoteVersions.customerCompanyName,
      customerContactEmail: quoteVersions.customerContactEmail,
      createdByUserId: serviceAgreements.createdByUserId,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(serviceAgreements)
    .innerJoin(
      quoteVersions,
      eq(quoteVersions.id, serviceAgreements.quoteVersionId),
    )
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, serviceAgreements.createdByUserId))
    .where(eq(serviceAgreements.id, agreement.id))
    .limit(1);

  if (!meta) return { ok: false, error: "Agreement context not found" };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(serviceAgreements)
      .set({
        status: "signed",
        customerSignedAt: now,
        customerSignedName: parsed.data.signedName,
        customerSignedFromIp: ip,
        customerSignedFromUserAgent: userAgent,
        updatedAt: now,
      })
      .where(eq(serviceAgreements.id, agreement.id));

    await tx.insert(activities).values({
      accountId: meta.accountId,
      opportunityId: meta.opportunityId,
      type: "note",
      direction: "inbound",
      subject: "Customer signed Service Agreement",
      body: `Signed by ${parsed.data.signedName} (IP ${ip}). Agreement is now active.`,
      ownerUserId: meta.createdByUserId,
    });
  });

  // Send a confirmation email to the customer (out-of-transaction since
  // it's a network call). Failures are logged but don't roll back the
  // signature — the signature is the legally-binding act, not the email.
  if (meta.customerContactEmail) {
    const sender = senderIdentityFor(meta.accountTerritory);
    const subject = `Confirmed — Filta Service Agreement signed`;
    const text = `Hi,

Thanks for signing the Service Agreement for ${meta.customerCompanyName}. We've recorded your signature and a copy is on file.

We'll be in touch in the next day or two to schedule your first visit. Welcome aboard.

— Filta ${sender.territoryLabel}`;
    const html = wrapInBaseHtml({
      territory: meta.accountTerritory,
      contentHtml: `<p>Hi,</p>
<p>Thanks for signing the Service Agreement for <strong>${meta.customerCompanyName}</strong>. We've recorded your signature and a copy is on file.</p>
<p>We'll be in touch in the next day or two to schedule your first visit. Welcome aboard.</p>
<p style="margin-top:20px;color:#475569;">— Filta ${sender.territoryLabel}</p>`,
      preheader: `Service Agreement signed for ${meta.customerCompanyName}.`,
    });

    const [send] = await db
      .insert(emailSends)
      .values({
        accountId: meta.accountId,
        contactId: null,
        opportunityId: meta.opportunityId,
        templateId: null,
        fromEmail: sender.fromEmail,
        fromName: sender.fromName,
        toEmail: meta.customerContactEmail,
        subject,
        bodyHtml: html,
        bodyText: text,
        status: "queued",
        sentByUserId: meta.createdByUserId,
      })
      .returning({ id: emailSends.id });

    const result = await sendEmail({
      from: sender.fromEmail,
      fromName: sender.fromName,
      to: meta.customerContactEmail,
      subject,
      html,
      text,
      replyTo: process.env.EMAIL_REPLY_TO || sender.fromEmail,
      tags: [{ name: "campaign", value: "agreement_signed_confirmation" }],
    });
    if (result.ok) {
      await db
        .update(emailSends)
        .set({
          status: "sent",
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    } else {
      await db
        .update(emailSends)
        .set({ status: "failed", providerError: result.error })
        .where(eq(emailSends.id, send.id));
    }
  }

  // Refresh rep-side surfaces.
  revalidatePath(`/accounts/${meta.accountId}`);
  revalidatePath(`/opportunities/${meta.opportunityId}`);
  revalidatePath(`/opportunities/${meta.opportunityId}/quote`);

  return { ok: true };
}
