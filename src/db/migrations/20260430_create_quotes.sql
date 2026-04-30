-- Week 5.1 — Versioned customer-facing quotes (FS proposal flow).
--
-- Adds two tables and two enums to support the quote-builder UI on the
-- opportunity detail page and the "Send quote" action that emails a PDF.
--
-- Design notes are in src/db/schema.ts; this file just wires the SQL.
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260430_create_quotes.sql
-- Idempotent.

BEGIN;

-- 1. Enums.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_status') THEN
    CREATE TYPE quote_status AS ENUM (
      'draft', 'sent', 'accepted', 'declined', 'expired'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_frequency') THEN
    CREATE TYPE quote_frequency AS ENUM (
      'per_visit', 'monthly', 'quarterly', 'annual', 'one_time'
    );
  END IF;
END $$;

-- 2. quote_versions.
CREATE TABLE IF NOT EXISTS quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status quote_status NOT NULL DEFAULT 'draft',
  customer_company_name text NOT NULL,
  customer_address jsonb,
  customer_contact_name text,
  customer_contact_email text,
  subtotal_monthly numeric(12, 2) NOT NULL DEFAULT 0,
  subtotal_quarterly numeric(12, 2) NOT NULL DEFAULT 0,
  subtotal_one_time numeric(12, 2) NOT NULL DEFAULT 0,
  estimated_annual numeric(12, 2) NOT NULL DEFAULT 0,
  valid_until date,
  notes text,
  sent_email_send_id uuid REFERENCES email_sends(id) ON DELETE SET NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS quote_versions_opportunity_idx
  ON quote_versions(opportunity_id);
CREATE INDEX IF NOT EXISTS quote_versions_status_idx
  ON quote_versions(status);

-- (opportunity_id, version_number) is the natural identity. Partial unique
-- so soft-deleted versions don't block a legitimate replacement.
CREATE UNIQUE INDEX IF NOT EXISTS quote_versions_opp_version_unique
  ON quote_versions(opportunity_id, version_number)
  WHERE deleted_at IS NULL;

-- 3. quote_line_items.
CREATE TABLE IF NOT EXISTS quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id uuid NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  service_type service_type, -- nullable; null = "Other" line
  description text NOT NULL,
  quantity numeric(10, 2) NOT NULL DEFAULT 1,
  unit_price numeric(10, 2) NOT NULL DEFAULT 0,
  frequency quote_frequency NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_line_items_version_idx
  ON quote_line_items(quote_version_id);

-- 4. RLS — territory scoped via opportunity → account, same shape as
-- email_sends and tasks. Webhook-style server jobs use the no-RLS db
-- handle; UI traffic goes through withSession() which sets app.user_id.
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_versions_territory_select ON quote_versions;
CREATE POLICY quote_versions_territory_select ON quote_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM opportunities o
      JOIN accounts a ON a.id = o.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE o.id = quote_versions.opportunity_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

DROP POLICY IF EXISTS quote_versions_territory_mutate ON quote_versions;
CREATE POLICY quote_versions_territory_mutate ON quote_versions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM opportunities o
      JOIN accounts a ON a.id = o.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE o.id = quote_versions.opportunity_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM opportunities o
      JOIN accounts a ON a.id = o.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE o.id = quote_versions.opportunity_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_line_items_territory_select ON quote_line_items;
CREATE POLICY quote_line_items_territory_select ON quote_line_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM quote_versions qv
      JOIN opportunities o ON o.id = qv.opportunity_id
      JOIN accounts a ON a.id = o.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE qv.id = quote_line_items.quote_version_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

DROP POLICY IF EXISTS quote_line_items_territory_mutate ON quote_line_items;
CREATE POLICY quote_line_items_territory_mutate ON quote_line_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM quote_versions qv
      JOIN opportunities o ON o.id = qv.opportunity_id
      JOIN accounts a ON a.id = o.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE qv.id = quote_line_items.quote_version_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM quote_versions qv
      JOIN opportunities o ON o.id = qv.opportunity_id
      JOIN accounts a ON a.id = o.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE qv.id = quote_line_items.quote_version_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

-- 5. updated_at triggers (reuse the email_infra function — generic enough).
DROP TRIGGER IF EXISTS quote_versions_updated_at ON quote_versions;
CREATE TRIGGER quote_versions_updated_at
  BEFORE UPDATE ON quote_versions
  FOR EACH ROW
  EXECUTE FUNCTION email_infra_set_updated_at();

DROP TRIGGER IF EXISTS quote_line_items_updated_at ON quote_line_items;
CREATE TRIGGER quote_line_items_updated_at
  BEFORE UPDATE ON quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION email_infra_set_updated_at();

COMMIT;
