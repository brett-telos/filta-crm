-- Week 4.0 — Sales funnel stage on accounts
--
-- Adds an account-level `sales_funnel_stage` column so the /leads view can
-- group prospects by funnel position even when no opportunity exists yet.
-- Reuses the existing pipeline_stage enum so leads kanban columns are
-- vocabulary-compatible with the deal kanban at /pipeline.
--
-- The companion `sales_funnel_stage_changed_at` lets the leads list sort by
-- "longest in this stage" — the staleness signal a rep cares about most.
-- `converted_at` records when the prospect flipped to customer; useful for
-- conversion-rate analytics later.
--
-- Backfill rules (see UPDATE block below for the actual queries):
--   - customer / churned        → 'closed_won' (they got past the funnel)
--   - do_not_contact            → 'closed_lost'
--   - prospect WITH any open opp → that opp's stage (most recent)
--   - prospect WITH only closed_lost opp(s) → 'closed_lost' (kept, not opened)
--   - prospect with no opp      → keep default 'new_lead'
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260429_add_sales_funnel_stage.sql
-- Idempotent.

BEGIN;

-- 1. Columns.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS sales_funnel_stage pipeline_stage NOT NULL
    DEFAULT 'new_lead';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS sales_funnel_stage_changed_at timestamptz NOT NULL
    DEFAULT now();

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

-- 2. Compound index for /leads (filter by status='prospect', group by stage).
CREATE INDEX IF NOT EXISTS accounts_status_funnel_idx
  ON accounts(account_status, sales_funnel_stage);

-- 3. Backfill.
--
-- Step A: customer / churned → closed_won. Includes converted_at = created_at
-- as a best-effort timestamp; we don't track historical conversion dates and
-- using created_at gives downstream charts something coherent to plot.
UPDATE accounts
SET sales_funnel_stage = 'closed_won',
    sales_funnel_stage_changed_at = COALESCE(updated_at, created_at),
    converted_at = COALESCE(updated_at, created_at)
WHERE account_status IN ('customer', 'churned')
  AND sales_funnel_stage = 'new_lead';

-- Step B: do_not_contact → closed_lost.
UPDATE accounts
SET sales_funnel_stage = 'closed_lost',
    sales_funnel_stage_changed_at = COALESCE(updated_at, created_at)
WHERE account_status = 'do_not_contact'
  AND sales_funnel_stage = 'new_lead';

-- Step C: prospects with at least one open opportunity inherit the most-
-- recently-updated open opp's stage. We treat 'closed_lost' opps as not
-- representative of the lead's current state — a prospect with one lost
-- service opp is still an active lead overall.
WITH best_open_opp AS (
  SELECT DISTINCT ON (o.account_id)
    o.account_id,
    o.stage,
    o.stage_changed_at
  FROM opportunities o
  WHERE o.deleted_at IS NULL
    AND o.stage NOT IN ('closed_lost')
  ORDER BY o.account_id, o.stage_changed_at DESC NULLS LAST
)
UPDATE accounts a
SET sales_funnel_stage = b.stage,
    sales_funnel_stage_changed_at = COALESCE(
      b.stage_changed_at,
      a.updated_at,
      a.created_at
    )
FROM best_open_opp b
WHERE a.id = b.account_id
  AND a.account_status = 'prospect'
  AND a.sales_funnel_stage = 'new_lead';

-- Step D: prospects whose ONLY opps are closed_lost → closed_lost.
WITH lost_only AS (
  SELECT o.account_id
  FROM opportunities o
  WHERE o.deleted_at IS NULL
  GROUP BY o.account_id
  HAVING bool_and(o.stage = 'closed_lost')
)
UPDATE accounts a
SET sales_funnel_stage = 'closed_lost',
    sales_funnel_stage_changed_at = COALESCE(a.updated_at, a.created_at)
FROM lost_only l
WHERE a.id = l.account_id
  AND a.account_status = 'prospect'
  AND a.sales_funnel_stage = 'new_lead';

-- Step E: prospects with no opps stay at 'new_lead' (default). No-op.

COMMIT;
