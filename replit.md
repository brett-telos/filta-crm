# Filta CRM — Replit Notes

Next.js 14 + Drizzle + Postgres CRM for Filta Fun Coast / Space Coast. See `README.md` for the full design rationale.

## Environment
- Postgres: provisioned via Replit (`DATABASE_URL` etc. set as secrets).
- Workflow: `Start application` → `npm run dev` (Next.js on port 5000, host 0.0.0.0, served via webview).
- Node 20.

## Data files (in `data/`)
- `filta_symphony_leads.csv` — 5,671 rows
- `260415_223827_billing_summary.csv` — March 2026
- `260415_224105_billing_summary.csv` — February 2026
- `260415_224134_billing_summary.csv` — January 2026

## Initial load (already run)
```
npm run db:generate
npm run db:migrate
npm run db:seed       # needs SEED_ADMIN_* env vars
npm run import:leads  # 3,912 inserted, 1,750 updated
npm run import:billing # 38 of 93 billing customers matched
```

Re-running is idempotent. The 55 unmatched billing customers are existing
customers that have no lead record (per README guidance — can be added manually
later).

## Local fixes applied to scaffold
- `scripts/import_billing.ts`: fixed `files.map(path.basename)` (passing the index
  as `suffix`) and added quote/whitespace stripping in `parseCustomerHeader`.
- `package.json`: `dev` now runs `next dev -p 5000 -H 0.0.0.0` so the Replit
  webview proxy can reach it.

## Admin user (seed)
- Email: `brett@telos.ventures`
- Password: `ChangeMe123!` (change on first login — only used because real value
  not yet set as a secret).
