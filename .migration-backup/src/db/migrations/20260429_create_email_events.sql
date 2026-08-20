-- Week 4.1 — Email engagement events (Resend webhooks + inbound replies)
--
-- Adds:
--   - email_event_type enum (delivered/opened/clicked/bounced/complained/
--     failed/replied)
--   - email_events table — one row per webhook event or matched inbound
--     reply, idempotent on Resend's event id
--   - engagement counter columns on email_sends (open_count, click_count,
--     first_opened_at, first_clicked_at, replied_at, last_event_at,
--     last_event_type) so list pages avoid a JOIN+aggregate on every render
--
-- Counters are maintained transactionally by the webhook handler. We don't
-- compute them from a trigger because the webhook also writes activities
-- and updates email_sends.status, and keeping all of that in one app-level
-- transaction is easier to reason about than splitting between TS and SQL.
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260429_create_email_events.sql
-- Idempotent.

BEGIN;

-- 1. Enum.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_event_type') THEN
    CREATE TYPE email_event_type AS ENUM (
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'failed',
      'replied'
    );
  END IF;
END $$;

-- 2. Counter columns on email_sends.
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0;
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz;
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS first_clicked_at timestamptz;
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS last_event_type email_event_type;

-- 3. email_events table.
CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_send_id uuid NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
  event_type email_event_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  -- Resend's evt_... id; null only for our synthetic 'replied' rows.
  provider_event_id text,
  link_url text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_events_send_idx
  ON email_events(email_send_id);
CREATE INDEX IF NOT EXISTS email_events_type_idx
  ON email_events(event_type);
CREATE INDEX IF NOT EXISTS email_events_occurred_at_idx
  ON email_events(occurred_at);

-- Idempotency key. Partial unique because synthetic replies (no provider
-- event id) shouldn't fight each other for uniqueness on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS email_events_provider_event_id_unique
  ON email_events(provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- 4. RLS — same shape as email_sends. Webhook handler bypasses RLS by
-- running with a service-role connection; UI reads use the user-scoped
-- connection and inherit the email_sends policy via the FK chain.
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_events_territory_select ON email_events;
CREATE POLICY email_events_territory_select ON email_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM email_sends s
      JOIN accounts a ON a.id = s.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE s.id = email_events.email_send_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

DROP POLICY IF EXISTS email_events_territory_mutate ON email_events;
CREATE POLICY email_events_territory_mutate ON email_events
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM email_sends s
      JOIN accounts a ON a.id = s.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE s.id = email_events.email_send_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM email_sends s
      JOIN accounts a ON a.id = s.account_id
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE s.id = email_events.email_send_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

COMMIT;
