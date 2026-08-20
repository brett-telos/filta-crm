-- Rename service_type enum value 'df' -> 'fd' to match Filta brand guidelines
-- (FiltaDrain = FD per the sub-brand abbreviation table).
--
-- Safe for existing data: ALTER TYPE ... RENAME VALUE updates the label in
-- place. All existing rows referencing the old value continue to work.
-- Also renames the JSONB key in accounts.service_profile so the
-- ServiceProfile TS type stays accurate against the data.
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260422_rename_df_to_fd.sql
-- Idempotent: uses conditional checks so rerunning is a no-op.

BEGIN;

-- 1. Rename the enum label (Postgres 10+). Wrapped in DO block so a repeat run
-- after rename doesn't fail — we skip if 'df' is already gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'service_type' AND e.enumlabel = 'df'
  ) THEN
    ALTER TYPE service_type RENAME VALUE 'df' TO 'fd';
  END IF;
END$$;

-- 2. Migrate the JSONB key in accounts.service_profile. We rename any
-- top-level `df` property to `fd`, preserving the payload. Only touch rows
-- that actually have a `df` key to keep the update set tight.
UPDATE accounts
SET service_profile = (service_profile - 'df') || jsonb_build_object('fd', service_profile->'df')
WHERE service_profile ? 'df';

COMMIT;
