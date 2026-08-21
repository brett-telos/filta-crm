-- Week 6.1 — Billing CSV import audit table.
--
-- Each monthly upload of the Filta billing CSV gets one row here. The row
-- carries the file hash (for idempotent reapply detection), pre-apply diff
-- snapshot, post-apply counters, and lifecycle status.
--
-- The actual writes happen against accounts.service_profile and
-- accounts.last_service_date — those columns already exist; we don't add
-- new account-level tables here.
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260502_create_billing_imports.sql
-- Or via:   npm run db:migrate
-- Idempotent.

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_import_status') THEN
    CREATE TYPE billing_import_status AS ENUM (
      'uploaded', 'previewed', 'applied', 'aborted'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS billing_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_hash text NOT NULL,
  file_size_bytes integer,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  applied_by_user_id uuid REFERENCES users(id),
  status billing_import_status NOT NULL DEFAULT 'uploaded',
  rows_total integer NOT NULL DEFAULT 0,
  accounts_inserted integer NOT NULL DEFAULT 0,
  accounts_updated integer NOT NULL DEFAULT 0,
  accounts_skipped integer NOT NULL DEFAULT 0,
  mrr_delta numeric(12, 2) NOT NULL DEFAULT 0,
  diff_snapshot jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_imports_uploaded_by_idx
  ON billing_imports(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS billing_imports_status_idx
  ON billing_imports(status);

-- Same file (by hash) can't be applied twice. Partial unique so an aborted
-- upload of the same file doesn't block a future legitimate apply.
CREATE UNIQUE INDEX IF NOT EXISTS billing_imports_file_hash_applied_unique
  ON billing_imports(file_hash)
  WHERE status = 'applied';

-- RLS — admin-only. Sales reps shouldn't be able to upload billing CSVs;
-- this is a Sam/Linda/Brett operation.
ALTER TABLE billing_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_imports_admin_select ON billing_imports;
CREATE POLICY billing_imports_admin_select ON billing_imports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.user_id', true)::uuid
        AND u.role = 'admin'
    )
  );

DROP POLICY IF EXISTS billing_imports_admin_mutate ON billing_imports;
CREATE POLICY billing_imports_admin_mutate ON billing_imports
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.user_id', true)::uuid
        AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.user_id', true)::uuid
        AND u.role = 'admin'
    )
  );

DROP TRIGGER IF EXISTS billing_imports_updated_at ON billing_imports;
CREATE TRIGGER billing_imports_updated_at
  BEFORE UPDATE ON billing_imports
  FOR EACH ROW
  EXECUTE FUNCTION email_infra_set_updated_at();

COMMIT;
