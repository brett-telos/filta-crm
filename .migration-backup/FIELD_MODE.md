# Field Mode (`/field`) — phone-first sales view

Added Aug 2026 on branch `claude/mobile-sales-v1`. Built for Ron, Will, Sam,
and Brett to use between customer visits: pull up a lead in seconds, dictate
the visit notes from the car, move the stage with one tap, and see the weekly
scoreboard.

## What's in this branch

- **`/field`** — the mobile app screen (also added to the top nav as "Field"):
  - Working-pipeline list (contacted/qualified/proposal/negotiation), search
    that reaches all ~5,600 leads server-side, stage chips with counts.
  - Lead card: one-tap Call / Text / Map, stage mover, the gold NEW UPDATE
    dictation box, Symphony file card, full activity feed.
  - "This Week" tab: milestones by rep (from the stage-change audit notes),
    pipeline bars, and the whole team's notes for the week.
  - Confetti when a deal is Won. Morale is a feature.
- **Field stage vocabulary** (`src/lib/field-stages.ts`): the agreed 5+Lost
  stages presented as a mapped view of the existing 7-value enum — NO
  migration, `/leads` and `/pipeline` are untouched. `qualified` folds into
  Contacted on read; `negotiation` is presented as Service Scheduled.
  Tapping Won calls the existing convertLeadAction (prospect → customer).
- **Symphony handoff**: file card on every lead (field names annotated with
  Symphony's funnel vocabulary) + `/api/field/symphony-export` CSV of all
  Service Scheduled leads (`?stage=won` for the last 30 days of conversions).
- **PWA**: `src/app/manifest.ts` + `public/brand/icon-192/512.png` (white
  swoosh on Filta Blue). Team can Add to Home Screen; it opens at /field.
- **Voice dictation**: the keyboard mic works in the textarea with zero code;
  the Dictate button additionally uses the Web Speech API where available and
  falls back gracefully.

## Build fixes riding along (pre-existing `next build` blockers)

`next dev` tolerated these; a production build did not. Each is its own commit:

1. `EditableInfoCard` Cancel button referenced parent-scoped `setEditing`.
2. `sendFsCrossSellEmailAction` param typed `z.infer` but `templateKey` has a
   zod default → callers legitimately omit it; now `z.input`.
3. Quote totals passed as numbers into drizzle `numeric()` columns (strings
   required); converted once with `.toFixed(2)`.
4. PDF routes: `Buffer` no longer satisfies `BodyInit` under current
   @types/node; wrapped in `new Uint8Array(buffer)`.
5. Middleware now allowlists `/brand/*` + `/manifest.webmanifest` (logo was
   404ing on the login page; manifest must be public for PWA install).
6. Login from a direct `/login` visit failed (`from` field absent →
   `formData.get` returns null → zod `.optional()` rejected it).

## Applying this branch in Replit (no GitHub write access from Cowork)

1. Upload `filta-crm-mobile-sales-v1.bundle` into the Replit workspace root
   (drag and drop into the file tree).
2. In the Replit shell:
   ```
   git fetch filta-crm-mobile-sales-v1.bundle claude/mobile-sales-v1:claude/mobile-sales-v1
   git merge claude/mobile-sales-v1        # from your main branch
   rm filta-crm-mobile-sales-v1.bundle
   ```
3. No `npm install` needed (no new dependencies) and **no DB migration**
   (no schema changes). Restart the app.
4. Push to GitHub from Replit as usual.

## Deliberately not done (talk first)

- The weekly digest email templates still use the 7-stage vocabulary; the
  in-app "This Week" tab covers Brett + Sam for now.
- No auth changes — Ron/Will/Sam get invited through /admin/users as usual.
- `qualified` stays writable from the desktop kanban; Field Mode just never
  writes it.

## Duplicate cleanup (`npm run dedupe`)

The Feb 2026 Symphony import re-landed businesses that already existed from
the 2013-2024 vintage data. Before the team starts dictating notes, merge the
provable twins so nobody updates the wrong record:

```
npm run dedupe -- --analyze     # dry run: writes dedupe_auto_plan.csv + dedupe_review.csv
npm run dedupe -- --apply       # merge the AUTO tier (phone-verified twins, same name+address)
npm run dedupe -- --apply --approved dedupe_review.csv   # after marking Action=merge/swap
```

- AUTO tier: same normalized phone + (similar name or same contact), or same
  name + same street address. Two live customers never auto-merge.
- REVIEW tier: same contact w/ different phones, same phone w/ different
  names, and chain-name patterns (same name, different phone AND address —
  usually two real locations, leave Action blank to keep both).
- Merges are transactional: activities/contacts/opps/tasks/emails/agreements
  move to the survivor, survivor gaps are filled from the loser, the loser is
  soft-deleted with a traceability note (incl. its Symphony ID). Nothing is
  hard-deleted; reruns are no-ops. `--limit N` for a test batch.
- The run CSVs are gitignored (lead PII — don't commit them).
