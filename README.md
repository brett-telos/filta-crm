# Filta CRM

A sales CRM for **Filta Fun Coast** (Volusia County, FL) and **Filta Space Coast**
(Brevard County, FL) — built to replace scattered tracking across Filta Symphony,
spreadsheets, and email.

Built as a Next.js 14 + Postgres application on Replit, modeled with an ontology
(Account / Contact / Opportunity / Activity / User) that's serviceable for both
pipeline management and the FiltaClean Cross-Sell Dashboard — the strategic
priority that came out of the Feb 2026 financial discovery (only 5 of 97 customers
have FiltaClean, and FS carries ~70% gross margin).

Full design rationale lives in `/Users/brettmerrill/Dropbox (Personal)/Telos/1. Corporate/Library/Claude/Filta-CRM-Design.md`.

---

## What's in this scaffold

```
filta-crm/
├── .env.example             # copy to .env, fill in DATABASE_URL
├── .replit                  # Replit config (Node 20 + Postgres 16)
├── drizzle.config.ts        # Drizzle ORM migration config
├── next.config.js
├── tailwind.config.ts
├── package.json             # deps + setup script chain
├── scripts/
│   ├── import_leads.ts      # Filta Symphony → Accounts/Contacts/FF opps
│   └── import_billing.ts    # Monthly billing CSVs → service_profile on Accounts
└── src/
    ├── app/                 # Next.js app-router UI (landing + verification stats)
    └── db/
        ├── schema.ts        # Full ontology: 16 enums, 9 tables, relations, types
        ├── index.ts         # Drizzle + pg Pool
        ├── migrate.ts       # Migration runner
        └── seed/
            ├── cities.ts    # Volusia + Brevard cities w/ known abbreviations
            └── run.ts       # Idempotent seeder (cities, pricing, competitors, admin)
```

---

## Setup on Replit (brett196 workspace)

1. **Create a new Repl** → Import from GitHub/ZIP → select this folder.
   Replit will pick up `.replit` and provision Node 20 + Postgres 16 automatically.

2. **Set secrets** (Replit → Tools → Secrets):

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | (auto-set by Replit's Postgres add-on) |
   | `NEXTAUTH_SECRET` | run `openssl rand -base64 32` on your Mac, paste result |
   | `SEED_ADMIN_EMAIL` | `brett@telos.ventures` |
   | `SEED_ADMIN_PASSWORD` | pick a strong one; change on first login |
   | `SEED_ADMIN_FIRST_NAME` | `Brett` |
   | `SEED_ADMIN_LAST_NAME` | `Merrill` |

3. **Upload source CSVs** to a `data/` folder in the Repl root:
   - `data/filta_symphony_leads.csv` (the 5,670-row leads export)
   - `data/260415_223827_billing_summary.csv` (March 2026)
   - `data/260415_224105_billing_summary.csv` (Feb 2026)
   - `data/260415_224134_billing_summary.csv` (Jan 2026)

4. **Install + run the one-shot setup** in the Replit shell:
   ```bash
   npm install
   npm run db:generate   # creates initial migration from schema
   npm run setup         # migrate + seed + import:leads + import:billing
   npm run dev           # start Next.js dev server
   ```

   `npm run setup` chains every data step; re-running it is safe (idempotent inserts +
   `ON CONFLICT DO NOTHING` everywhere).

5. **Verify** — open the Replit webview. The landing page shows live counts:
   - Total accounts (should be ~5,670 after leads import)
   - Customers (accounts with any billing revenue — should be ~90)
   - Fun Coast / Space Coast splits (city-county mapping)
   - Opportunities (one FF opp auto-created per lead with fryer count)

---

## What each import does

### `scripts/import_leads.ts`

Parses `filta_symphony_leads.csv` and for each row:

- Normalizes phone to E.164 via `libphonenumber-js`.
- Looks up city → county → territory (Volusia → `fun_coast`, Brevard → `space_coast`,
  unknown → `unassigned`). Unknown cities are logged for manual review.
- Dedupes in priority: `filta_record_id` exact → phone + fuzzy company name
  (Levenshtein ≤ 20% normalized) → exact normalized company name.
- Maps Filta "Sales Funnel" values → 7-stage pipeline
  (`new_lead` / `contacted` / `qualified` / `proposal` / `negotiation` / `closed_won`
  / `closed_lost`). Unmapped values fall back to `new_lead` and are logged.
- Flags NCAs by pattern (Avendra, Compass, Sodexo, Entegra, Aramark, Metz,
  Delaware North, Legends, HHS) or any non-empty NCA column.
- Creates a primary Contact from the "Contact" column when present.
- **Auto-creates a FiltaFry opportunity** when fryer count is known:
  `estimated_value_annual = fryers × $300 × 12`.

Expected final state: ~5,670 accounts, ~4,500 primary contacts, ~1,500 FF opps.

### `scripts/import_billing.ts`

Parses the monthly `*_billing_summary.csv` files (the FiltaSymphony invoice
format: customer-header blocks like `"Aden Senior Living: 03/15/2026 12:00am |
Performed"` followed by FF / FS / FB / FG line items). For each customer:

- Sums revenue per service across all 3 months.
- Divides by the file count to produce `monthly_revenue`.
- Writes `service_profile` JSONB on matching Accounts:
  ```json
  {
    "ff": {"active": true, "monthly_revenue": 485.00, "last_service_date": "2026-03-31"},
    "fs": {"active": false, "monthly_revenue": 0},
    "fb": {"active": true, "monthly_revenue": 12.50}
  }
  ```
- Flips `account_status = 'customer'` for any match with non-zero revenue.
- Unmatched customers are logged; usually fixed by running `import:leads` first
  (so the account exists) or by adding a manual account for a legacy customer
  that never had a lead record.

Note on `FG`: the billing CSV's `FG` line items are "Oil Sold to Customer" (typically
$0.00). That is **not** the same as the schema's `fg` = FiltaGold deep clean service.
When non-zero, `FG` is captured separately in `service_profile.fg_oil_sold` so the
FiltaGold enum stays clean for the real service. Flag this to Sam/Linda before
rolling out reports.

---

## The FiltaClean Cross-Sell Dashboard

Once both imports have run, the cross-sell target list is a single query:

```sql
SELECT a.company_name, a.city, a.territory,
       (a.service_profile->'ff'->>'monthly_revenue')::numeric AS ff_mo_rev,
       a.owner_user_id
FROM accounts a
WHERE a.account_status = 'customer'
  AND (a.service_profile->'ff'->>'active')::boolean = true
  AND COALESCE((a.service_profile->'fs'->>'active')::boolean, false) = false
  AND a.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM opportunities o
    WHERE o.account_id = a.id
      AND o.service_type = 'fs'
      AND o.stage NOT IN ('closed_won','closed_lost')
  )
ORDER BY ff_mo_rev DESC;
```

Expected: ~89 targets based on the Feb 2026 discovery snapshot. The UI for this
ships in Week 2 (see design doc §9).

---

## Local dev (your Mac, outside Replit)

If you want to run locally:

```bash
# Start a local Postgres (Docker)
docker run --name filta-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
export DATABASE_URL="postgres://postgres:dev@localhost:5432/postgres"

npm install
npm run db:generate
npm run db:migrate
npm run db:seed
LEADS_CSV=/path/to/filta_symphony_leads.csv npm run import:leads
BILLING_DIR=/path/to/billing-csvs       npm run import:billing
npm run dev
```

---

## Brand tokens

The Tailwind config exposes two tokens for Filta's visual style. Adjust when we
nail down the exact palette from the Filta Corporate brand kit:

- `filta-primary` — primary brand color (buttons, headings)
- `filta-muted`   — soft neutral background

---

## Next up (Week 2)

From the design doc:

1. Authentication with Replit Auth / NextAuth (email + password + reset).
2. Account list + detail pages with activity timeline.
3. Kanban pipeline board (drag-drop across stages; owner + territory filters).
4. FiltaClean Cross-Sell Dashboard UI.
5. Row-level security policies so a Fun Coast rep only sees Fun Coast accounts.
6. Mobile-first polish for field reps (tap-to-call, quick log).

---

_Generated during the Week 1 scaffolding sprint (Apr 2026). Design doc:
`/Users/brettmerrill/Dropbox (Personal)/Telos/1. Corporate/Library/Claude/Filta-CRM-Design.md`._
