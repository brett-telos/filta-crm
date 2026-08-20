-- Week 3.1 — Email infrastructure
--
-- Adds `message_templates` (reusable subject/body copy) and `email_sends`
-- (one row per recipient per send) so the FS cross-sell dashboard can
-- dispatch branded emails via Resend and the account detail page can
-- render a "Sent emails" history card.
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260424_create_email_infra.sql
-- Idempotent — safe to rerun.

BEGIN;

-- 1. Enums.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_status') THEN
    CREATE TYPE email_status AS ENUM (
      'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_template_purpose') THEN
    CREATE TYPE message_template_purpose AS ENUM (
      'fs_cross_sell', 'general_followup', 'proposal_sent', 'other'
    );
  END IF;
END $$;

-- 2. message_templates.
CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose message_template_purpose NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  subject_template text NOT NULL,
  body_html_template text NOT NULL,
  body_text_template text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_key_unique
  ON message_templates(key);
CREATE INDEX IF NOT EXISTS message_templates_purpose_idx
  ON message_templates(purpose);

-- 3. email_sends.
CREATE TABLE IF NOT EXISTS email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  from_email text NOT NULL,
  from_name text,
  to_email text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  status email_status NOT NULL DEFAULT 'queued',
  provider_message_id text,
  provider_error text,
  sent_by_user_id uuid NOT NULL REFERENCES users(id),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_sends_account_idx ON email_sends(account_id);
CREATE INDEX IF NOT EXISTS email_sends_contact_idx ON email_sends(contact_id);
CREATE INDEX IF NOT EXISTS email_sends_opportunity_idx
  ON email_sends(opportunity_id);
CREATE INDEX IF NOT EXISTS email_sends_sent_by_idx ON email_sends(sent_by_user_id);
CREATE INDEX IF NOT EXISTS email_sends_status_idx ON email_sends(status);
-- Partial unique index — multiple rows can have NULL provider_message_id
-- (e.g. rows still in 'queued' status), but once a Resend message ID is
-- set it should be globally unique so webhook matching stays deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS email_sends_provider_message_id_unique
  ON email_sends(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 4. RLS.
-- message_templates: no territory scope — templates are org-wide. We still
-- enable RLS so mutations route through the same auth gate, but allow any
-- authed user to read/mutate. Admins-only-writes can be enforced at the
-- app layer later; for now the CRM is small enough that template edits
-- are a rare, deliberate action.
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_templates_all ON message_templates;
CREATE POLICY message_templates_all ON message_templates
  FOR ALL
  USING (current_setting('app.user_id', true) IS NOT NULL)
  WITH CHECK (current_setting('app.user_id', true) IS NOT NULL);

-- email_sends: territory-scoped via account, same shape as tasks.
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_sends_territory_select ON email_sends;
CREATE POLICY email_sends_territory_select ON email_sends
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = email_sends.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

DROP POLICY IF EXISTS email_sends_territory_mutate ON email_sends;
CREATE POLICY email_sends_territory_mutate ON email_sends
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = email_sends.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = email_sends.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

-- 5. updated_at triggers (reuse a small shared function).
CREATE OR REPLACE FUNCTION email_infra_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_templates_updated_at ON message_templates;
CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW
  EXECUTE FUNCTION email_infra_set_updated_at();

DROP TRIGGER IF EXISTS email_sends_updated_at ON email_sends;
CREATE TRIGGER email_sends_updated_at
  BEFORE UPDATE ON email_sends
  FOR EACH ROW
  EXECUTE FUNCTION email_infra_set_updated_at();

COMMIT;
