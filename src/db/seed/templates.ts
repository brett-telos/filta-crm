// Seed copy for `message_templates`.
//
// Why a seed, not a migration:
//  - Template copy is data we expect to iterate on (subject line A/B tests,
//    seasonal tweaks). Migrations are for structure.
//  - The seed runner already upserts reference data; extending it keeps the
//    bootstrap story as one command (`npm run db:seed`).
//
// The `key` column is the stable handle the app looks templates up by.
// Treat keys as API — renaming one breaks the send flow. If copy needs a
// major rewrite, add a new key (`fs_cross_sell_v2`) and flip the caller.
//
// Placeholders available to all templates (the cross-sell dashboard's
// send-and-log flow fills these in from the account + contact + sending
// user):
//
//   {{firstName}}        — primary contact first name, or "there" on fallback
//   {{companyName}}      — account name
//   {{senderFirstName}}  — first name of the rep sending (users.first_name)
//   {{senderFullName}}   — full name of the rep (optional, for formal sign-off)
//   {{territoryLabel}}   — "Fun Coast" or "Space Coast"

import { db, messageTemplates } from "../index";

type TemplateSeed = {
  key: string;
  purpose: "fs_cross_sell" | "general_followup" | "proposal_sent" | "other";
  name: string;
  subjectTemplate: string;
  bodyHtmlTemplate: string;
  bodyTextTemplate: string;
};

// ---------- FS CROSS-SELL v1 ----------
//
// Audience: existing FF (FiltaFry) customers with no active FS (FiltaClean /
// FiltaShield) service and no open FS opp. They already trust us on fryer
// oil; the ask is a 10-minute conversation about adding hood deep-clean.
//
// Tone: friendly, short, specific. Leads with "we're already here" since
// they know the crew. Avoids pressure language ("limited offer") — Filta's
// brand is steady and service-led, not promotional.
//
// Length: 3 short paragraphs + soft CTA. Designed to render cleanly on
// mobile without scrolling past the fold.

const FS_CROSS_SELL_V1_TEXT = `Hi {{firstName}},

{{senderFirstName}} here from Filta {{territoryLabel}}. We've been handling your fryer oil at {{companyName}} for a while now — wanted to check in on one service most of our kitchens don't realize we also run.

FiltaClean is our exhaust hood deep-clean service. NFPA 96-compliant, handled by our own trained crews (no subcontractors), and usually priced below whichever hood vendor kitchens in {{territoryLabel}} are currently using. Because we're already on-site for your oil service, scheduling is easy and we can work around your busy shifts.

A lot of our oil customers end up consolidating hood cleaning with us once they see the numbers. Open to a 10-minute call this week? I'm happy to come by for a free walk-through and send over a quote.

Thanks so much,
{{senderFirstName}}
Filta {{territoryLabel}}`;

const FS_CROSS_SELL_V1_HTML = `<p>Hi {{firstName}},</p>

<p>{{senderFirstName}} here from Filta {{territoryLabel}}. We've been handling your fryer oil at <strong>{{companyName}}</strong> for a while now — wanted to check in on one service most of our kitchens don't realize we also run.</p>

<p><strong>FiltaClean</strong> is our exhaust hood deep-clean service. NFPA&nbsp;96-compliant, handled by our own trained crews (no subcontractors), and usually priced below whichever hood vendor kitchens in {{territoryLabel}} are currently using. Because we're already on-site for your oil service, scheduling is easy and we can work around your busy shifts.</p>

<p>A lot of our oil customers end up consolidating hood cleaning with us once they see the numbers. Open to a 10-minute call this week? I'm happy to come by for a free walk-through and send over a quote.</p>

<p style="margin-top:20px;">Thanks so much,<br>
<strong>{{senderFirstName}}</strong><br>
<span style="color:#475569;">Filta {{territoryLabel}}</span></p>`;

// ---------- PROPOSAL SENT v1 (Week 5.1) ----------
//
// Cover note that goes out with a quote PDF attachment. Short and warm —
// the PDF carries the full proposal; the email's job is to make sure the
// recipient actually opens it. Includes the headline annual value so the
// recipient can scan from preview pane without opening the attachment.

const PROPOSAL_SENT_V1_TEXT = `Hi {{firstName}},

Attached is the Filta proposal for {{companyName}}. Headline: {{annualValue}} estimated annual value across the services we discussed.

Take a look when you have a moment. Reply or call if you want to talk through any of it — once you're ready to move forward we'll send the full Service Agreement for signature and schedule the first visit within a week.

Thanks,
{{senderFirstName}}
Filta {{territoryLabel}}`;

const PROPOSAL_SENT_V1_HTML = `<p>Hi {{firstName}},</p>

<p>Attached is the Filta proposal for <strong>{{companyName}}</strong>. Headline: <strong>{{annualValue}}</strong> estimated annual value across the services we discussed.</p>

<p>Take a look when you have a moment. Reply or call if you want to talk through any of it — once you're ready to move forward we'll send the full Service Agreement for signature and schedule the first visit within a week.</p>

<p style="margin-top:20px;">Thanks,<br>
<strong>{{senderFirstName}}</strong><br>
<span style="color:#475569;">Filta {{territoryLabel}}</span></p>`;

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: "fs_cross_sell_v1",
    purpose: "fs_cross_sell",
    name: "FS Cross-Sell — v1 (soft intro)",
    subjectTemplate:
      "Quick favor, {{firstName}} — hood cleaning at {{companyName}}",
    bodyHtmlTemplate: FS_CROSS_SELL_V1_HTML,
    bodyTextTemplate: FS_CROSS_SELL_V1_TEXT,
  },
  {
    key: "proposal_sent_v1",
    purpose: "proposal_sent",
    name: "Proposal Sent — v1 (cover note)",
    subjectTemplate: "Your Filta proposal — {{companyName}}",
    bodyHtmlTemplate: PROPOSAL_SENT_V1_HTML,
    bodyTextTemplate: PROPOSAL_SENT_V1_TEXT,
  },
];

/**
 * Upserts every template in TEMPLATE_SEEDS by unique `key`. Subject + body
 * fields are refreshed on each run so iterating on copy is just:
 *   1. edit this file
 *   2. `npm run db:seed`
 *
 * `active` defaults to true on insert and is left untouched on update so an
 * operator who manually flips a template off in prod won't have their change
 * silently reverted.
 *
 * `createdByUserId` is left NULL — templates are operator-authored copy,
 * not user-generated content.
 */
export async function seedMessageTemplates(): Promise<void> {
  for (const t of TEMPLATE_SEEDS) {
    await db
      .insert(messageTemplates)
      .values({
        key: t.key,
        purpose: t.purpose,
        name: t.name,
        subjectTemplate: t.subjectTemplate,
        bodyHtmlTemplate: t.bodyHtmlTemplate,
        bodyTextTemplate: t.bodyTextTemplate,
      })
      .onConflictDoUpdate({
        target: messageTemplates.key,
        set: {
          purpose: t.purpose,
          name: t.name,
          subjectTemplate: t.subjectTemplate,
          bodyHtmlTemplate: t.bodyHtmlTemplate,
          bodyTextTemplate: t.bodyTextTemplate,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`Seeded ${TEMPLATE_SEEDS.length} message template(s).`);
}
