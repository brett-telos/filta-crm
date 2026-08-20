# Email inbound + engagement setup (Resend)

This runbook walks through the one-time setup needed to flip the CRM from
the dev stub (no real email) to live engagement tracking with replies
parsed back into the activity timeline.

You can do this in chunks — outbound sending works without inbound DNS,
and engagement events work without reply parsing. The end state has all
three turned on.

---

## What you're setting up

| Capability | Requires | What it unlocks |
|---|---|---|
| Outbound sending | `RESEND_API_KEY` + verified sending domain | The "Send FS email" button actually delivers mail |
| Engagement tracking (opens, clicks, bounces) | Resend webhook → `/api/webhooks/resend/events` + `RESEND_WEBHOOK_SECRET` | Engagement chip on /cross-sell, status pills on /accounts/[id] |
| Reply ingestion | Reply subdomain + MX records + Resend inbound webhook → `/api/webhooks/resend/inbound` | Replies appear in the timeline as inbound email and auto-complete the 5-day follow-up task |

---

## Step 1 — Verify your sending domains

In the Resend dashboard, add and verify:
- `filtafuncoast.com`
- `filtaspacecoast.com`

Resend will give you a set of TXT/CNAME records (SPF, DKIM, optionally
DMARC). Add them at your domain registrar. Verification usually takes
under an hour.

Once verified, you'll be able to send from:
- `sales@filtafuncoast.com` (Filta Fun Coast)
- `sales@filtaspacecoast.com` (Filta Space Coast)

These are the "from" addresses the CRM uses based on the recipient
account's territory — see `senderIdentityFor` in `src/lib/email-templates.ts`.

> **Don't want those exact addresses?** Open `email-templates.ts` and
> change them. The constants are isolated in one function.

---

## Step 2 — Create the API key + drop it in Replit

Resend dashboard → API Keys → "Create API Key" with full sending
permission (`emails:send`). Copy it.

In Replit → Secrets, add:

```
RESEND_API_KEY=re_********
```

The CRM will pick it up on the next request — the env var is read at send
time, no restart needed.

> **Sanity check**: hit "Send FS email" on a row in `/cross-sell` for an
> account where you control the inbox. The button should show "Sent" and
> the Resend dashboard should show the message in Logs.

---

## Step 3 — Wire the events webhook (engagement tracking)

In Resend dashboard → Webhooks → "Add Endpoint":

- **URL**: `https://<your-replit-domain>/api/webhooks/resend/events`
- **Events to send**: select all of:
  - `email.delivered`
  - `email.delivery_delayed`
  - `email.opened`
  - `email.clicked`
  - `email.bounced`
  - `email.complained`
  - `email.failed`

Resend will show a signing secret that starts with `whsec_`. Copy it.

In Replit → Secrets, add:

```
RESEND_WEBHOOK_SECRET=whsec_********
```

> **Sanity check**: send another test email. Open it. Within ~30 seconds
> the engagement chip on `/cross-sell` should flip from "Sent" to
> "Opened 1×" and the "Emails sent" card on the account detail page
> should update. If nothing happens, check Resend dashboard → Webhooks →
> Logs — you'll see 401s if the secret is wrong, 200s if it worked.

---

## Step 4 — Reply subdomain + MX records (inbound)

This is the only step that actually requires DNS work beyond what
Resend gave you in Step 1.

We use plus-addressing on a dedicated reply subdomain so:
1. Outbound mail and inbound mail can be configured independently.
2. We can match a reply back to the original send by parsing the
   `emailSendId` out of the local part (`reply+<id>@reply.<domain>`).

### Records to add

For **`reply.filtafuncoast.com`** (and the same pattern for
`reply.filtaspacecoast.com`):

| Type | Host | Value | Priority |
|---|---|---|---|
| MX | `reply.filtafuncoast.com` | `inbound-smtp.resend.com` | 10 |

That's it — one MX record per reply subdomain. No A/CNAME needed.

> **Why a subdomain instead of `filtafuncoast.com` directly?** Two reasons.
> First, you may already have email service on the apex domain (Google
> Workspace, etc.) and we don't want to fight over MX records. Second,
> isolating reply traffic to a subdomain means the rest of your email
> infrastructure is unaffected if Resend's inbound parsing has a hiccup.

### In Resend dashboard

Resend → Inbound → "Add Domain":
- Add `reply.filtafuncoast.com`
- Add `reply.filtaspacecoast.com`

Resend will verify the MX record. Once green, configure the inbound
webhook for each domain:

- **URL**: `https://<your-replit-domain>/api/webhooks/resend/inbound`
- **Signing secret**: same `RESEND_WEBHOOK_SECRET` you set in Step 3
  (Resend uses one signing key per project across all webhooks)

> **Sanity check**: from a real inbox, reply to a CRM email. Within ~30
> seconds:
> - the reply shows up on the account's activity timeline as an inbound
>   email
> - the engagement chip flips to green "Replied"
> - the 5-day follow-up task auto-completes (visible on `/today` and
>   the account's "Next steps" card)

---

## Troubleshooting

**Webhook returns 401 / "Signature mismatch"**
The secret in Replit doesn't match what Resend is signing with. Re-copy
from Resend dashboard, paste into Replit Secrets, redeploy.

**Webhook returns 503 / "RESEND_WEBHOOK_SECRET not configured"**
The secret env var is empty or unset. Check Replit Secrets and that
the deployment was rebuilt after the secret was added.

**Outbound emails go out, no engagement events arrive**
Check Resend dashboard → Webhooks → Logs. If the events webhook URL is
wrong (typo, old Replit URL), the deliveries themselves still happen but
events go to /dev/null. Update the URL.

**Inbound replies don't show up**
Check Resend dashboard → Inbound → Logs. Common causes:
- MX record not propagated yet (give DNS up to 24h)
- Reply was sent to the friendly `sales@` address rather than the
  `reply+<id>@reply.` plus-tagged address. Recipients sometimes "Reply
  All" to the From header instead of Reply-To. The CRM's outbound emails
  set Reply-To explicitly so the rep's name in From doesn't capture the
  reply, but some clients still misroute.

**An email got delivered but engagement chip says "Cold"**
Engagement is only counted if Resend's open/click pixel fires. Some
corporate inboxes block tracking pixels (then opens won't register, but
clicks still will if the recipient clicks a link). Replies always count.

---

## Things to revisit later

- **Reply-routing for unmatched mail**: anything sent to `reply.<domain>`
  without a recognizable plus-tag currently 200s with a `console.warn`.
  If we start seeing useful stranded replies, we'll add a
  `/admin/unmatched-replies` queue.
- **DMARC policy**: once the sending domains have been live for a few
  weeks, tighten DMARC from `p=none` to `p=quarantine`. Resend dashboard
  has a tool that monitors aggregate reports.
- **Suppression list sync**: Resend manages bounces/complaints in their
  own suppression list, but we should also flag complainers as
  `do_not_contact` in the CRM. Currently a manual step; can be automated
  by extending the events webhook handler.
