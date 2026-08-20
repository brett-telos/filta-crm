-- Week 3.0 — Tasks & follow-ups
--
-- Creates the `tasks` table plus its two supporting enums. A task is the
-- "next step" for an account or opportunity — call back, send FS quote, etc.
-- Completing a task writes a companion activity row so the timeline remains
-- the single source of truth for "what happened".
--
-- Run with: psql $DATABASE_URL -f src/db/migrations/20260423_create_tasks.sql
-- Idempotent — safe to rerun (all CREATEs use IF NOT EXISTS / guarded DO).

BEGIN;

-- 1. Enums. Wrapped in DO blocks so a rerun after creation doesn't error.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('open', 'done', 'snoozed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
    CREATE TYPE task_priority AS ENUM ('low', 'normal', 'high');
  END IF;
END $$;

-- 2. Table.
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  assignee_user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  notes text,
  due_date date NOT NULL,
  status task_status NOT NULL DEFAULT 'open',
  priority task_priority NOT NULL DEFAULT 'normal',
  completed_at timestamptz,
  snooze_count integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id),
  auto_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes.
CREATE INDEX IF NOT EXISTS tasks_account_idx ON tasks(account_id);
CREATE INDEX IF NOT EXISTS tasks_opportunity_idx ON tasks(opportunity_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_user_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_status_due_idx
  ON tasks(assignee_user_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_status_due_idx ON tasks(status, due_date);

-- 4. Row-level security: tasks inherit the territory of their account.
-- A user with territory scope 'both' sees everything; 'fun_coast' sees only
-- tasks whose account is in the Fun Coast territory; same for 'space_coast'.
-- Uses the same `app.user_id` GUC pattern as accounts/opportunities.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_territory_select ON tasks;
CREATE POLICY tasks_territory_select ON tasks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = tasks.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

DROP POLICY IF EXISTS tasks_territory_mutate ON tasks;
CREATE POLICY tasks_territory_mutate ON tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = tasks.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      JOIN users u ON u.id = current_setting('app.user_id', true)::uuid
      WHERE a.id = tasks.account_id
        AND (u.territory = 'both' OR u.territory::text = a.territory::text)
    )
  );

-- 5. updated_at trigger.
CREATE OR REPLACE FUNCTION tasks_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION tasks_set_updated_at();

COMMIT;
