-- Week 6.0 — Service Agreements (signing flow).
--
-- Adds the `service_agreements` table and its status enum. One agreement
-- per accepted quote_version; created when a rep marks a quote 'accepted'.
-- The agreement carries everything needed to render the multi-page
-- corporate Service Agreement PDF (term dates, signature timestamps) plus
-- references back to the email_sends row that delivered it.
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260501_create_service_agreements.sql
-- Or via:   npm run db:migrate
-- Idempotent.

BEGIN;

-- 1. Status enum.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_agreement_status') THEN
    CREATE TYPE service_agreement_status AS ENUM (
      'draft', 'sent', 'signed', 'active', 'terminated'
    );
  END IF;
END $$;

-- 2. service_agreements.
CREATE TABLE IF NOT EXISTS service_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id uuid NOT NULL REFERENCES quote_versions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status service_agreement_status NOT NULL DEFAULT 'draft',
  term_start_date date,
  term_end_date date,
  sent_to_email text,
  sent_at timestamptz,
  sent_email_send_id uuid REFERENCES email_sends(id) ON DELETE SET NULL,
  customer_signed_at timestamptz,
  customer_signed_name text,
  filta_signed_at timestamptz,
  filta_signed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  terminated_at timestamptz,
  termination_reason text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS service_agreements_account_idx
  ON service_agreements(account_id);
CREATE INDEX IF NOT EXISTS service_agreements_quote_version_idx
  ON service_agreements(quote_version_id);
CREATE INDEX IF NOT EXISTS service_agreements_status_idx
  ON service_agreements(status);

-- One non-deleted agreement per accepted quote_version. Soft-deleted rows
-- excluded from the constraint so a reissue can replace a stale agreement.
CREATE UNIQUE INDEX IF NOT EXISTS service_agreements_quote_version_unique
  ON service_agreements(quote_version_id)
  WHERE deleted_at IS NULL;

-- 3. RLS — territory scoped via account.
ALTER TABLE service_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_agreements_territory_select ON service_agreements;
CREATE POLICY service_agreements_territory_select ON service_agreements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = service_agreements.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

DROP POLICY IF EXISTS service_agreements_territory_mutate ON service_agreements;
CREATE POLICY service_agreements_territory_mutate ON service_agreements
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = service_agreements.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = service_agreements.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

-- 4. updated_at trigger (reuse the email_infra function — generic enough).
DROP TRIGGER IF EXISTS service_agreements_updated_at ON service_agreements;
CREATE TRIGGER service_agreements_updated_at
  BEFORE UPDATE ON service_agreements
  FOR EACH ROW
  EXECUTE FUNCTION email_infra_set_updated_at();

COMMIT;
