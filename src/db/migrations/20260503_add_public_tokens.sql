-- Week 7.0 — Public link tokens for customer-facing quote/agreement views.
--
-- Adds public_token_hash + public_token_expires_at + a few audit columns
-- to both quote_versions and service_agreements. Tokens are generated
-- server-side as URL-safe random strings and only their sha256 hash lives
-- in the database; the raw token only ever appears in the customer's
-- email body, making link sharing safe-ish (anyone with the link can
-- view, but they can't enumerate other customers' links).
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260503_add_public_tokens.sql
-- Or via:   npm run db:migrate
-- Idempotent.

BEGIN;

-- 1. quote_versions columns.
ALTER TABLE quote_versions
  ADD COLUMN IF NOT EXISTS public_token_hash text;
ALTER TABLE quote_versions
  ADD COLUMN IF NOT EXISTS public_token_expires_at timestamptz;
ALTER TABLE quote_versions
  ADD COLUMN IF NOT EXISTS customer_viewed_at timestamptz;

-- Lookup by hash for the /q/[token] viewer. Partial unique so multiple
-- rows with NULL hash (older quotes pre-W7.0) coexist fine.
CREATE UNIQUE INDEX IF NOT EXISTS quote_versions_public_token_hash_unique
  ON quote_versions(public_token_hash)
  WHERE public_token_hash IS NOT NULL;

-- 2. service_agreements columns. Plus IP and user-agent capture from the
-- public sign POST so we have a forensic trail if a signature is later
-- contested.
ALTER TABLE service_agreements
  ADD COLUMN IF NOT EXISTS public_token_hash text;
ALTER TABLE service_agreements
  ADD COLUMN IF NOT EXISTS public_token_expires_at timestamptz;
ALTER TABLE service_agreements
  ADD COLUMN IF NOT EXISTS customer_viewed_at timestamptz;
ALTER TABLE service_agreements
  ADD COLUMN IF NOT EXISTS customer_signed_from_ip text;
ALTER TABLE service_agreements
  ADD COLUMN IF NOT EXISTS customer_signed_from_user_agent text;

CREATE UNIQUE INDEX IF NOT EXISTS service_agreements_public_token_hash_unique
  ON service_agreements(public_token_hash)
  WHERE public_token_hash IS NOT NULL;

COMMIT;
