# QBO Billing Correction (source of truth)

This update makes the Filta CRM operational with **correct billing data** by
switching the customer service profiles from FiltaSymphony to **QuickBooks
Online (QBO)**, which is the financial system of record.

## Why this was needed

The original `scripts/import_billing.ts` reads the FiltaSymphony billing
summary. The June 2026 QBO reconciliation proved Symphony materially
understates the truth:

| Service | Symphony (old CRM data) | QBO (truth) |
|---|---|---|
| FiltaClean (FS) | Captured about 5 percent. Implied roughly 5 customers have FS. | 19 customers carry FiltaClean, led by SpaceX at about $13,500 per month. |
| FiltaGold (FG) | Never populated. Symphony's "FG" line is "Oil Sold to Customer" (about $0), a different thing. | 4 customers carry real FiltaGold (QBO account 47750). |
| FiltaFry (FF) | Per visit, restates over time. | Actual invoiced amounts. |

Because the **FiltaClean Cross-Sell Dashboard** lists FF-active customers
**without** FS, the wrong FS data made it list customers who already have
FiltaClean as cross-sell targets. The QBO data fixes that: the 19 real FS
customers are now correctly excluded, and the remaining FF customers are
ranked by true FF revenue.

## What the new import does

`scripts/import_billing_qbo.ts`:

1. Reads `data/qbo_billing_2026.csv` (92 customers, 5-month average Jan to May
   2026, "The Filta Group" HQ/intercompany line excluded).
2. Matches each QBO customer to an existing account using the same name
   normalizer and fuzzy matcher as the Symphony import.
3. **Merges** the corrected `ff`, `fs`, and `fg` into each account's
   `service_profile`, preserving the Symphony `fb` (FiltaBio) flag and any
   `fg_oil_sold` already there.
4. Flips `account_status = 'customer'` for any account with QBO revenue.

It is idempotent. Run it AFTER `import:billing` so the FiltaBio flag survives.

## How to apply

1. Copy these files into the repo:
   - `data/qbo_billing_2026.csv`
   - `scripts/import_billing_qbo.ts`
   - `package.json` (adds the `import:billing:qbo` script and chains it into `setup`)
2. Commit and push to `main` (Replit pulls from GitHub).
3. In the Replit shell, run either:
   - `npm run import:billing:qbo` (just the QBO correction), or
   - `npm run setup` (full chain, now includes the QBO step at the end).
4. Verify: the FiltaClean Cross-Sell Dashboard should now show about 73 real
   targets (FF customers without FS), and SpaceX, AdventHealth, Sonny's
   Orange City, Hull's, and the other 15 FS customers should NOT appear as
   targets.

## Notes and follow-ups

- **SpaceX** is one umbrella in QBO but may exist as separate locations
  (Hangar X, food trucks) in the accounts table. If it shows as unmatched,
  re-run with `LOOSE_MATCH=1` or map it to the right account manually.
- **FiltaBio (FB)** oil-sale revenue is a company-level line in QBO (about
  $30,000 per month, 79 percent Volusia), not billed per customer, so it is
  not set per account here. The Symphony `fb` active flag is preserved.
- **Service pricing config** (`service_pricing_config`): defaults are FF
  $300 per fryer per month and FS $750 per quarter. For reference, observed
  QBO FiltaClean averages about $371 per month per FS customer (about $1,113
  per quarter). Update the config only if you want the auto-estimator to use
  observed rates rather than list price; left unchanged here.
