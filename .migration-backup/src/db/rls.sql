-- Row-Level Security policies for Filta CRM.
--
-- These are a defense-in-depth layer on top of the in-query territory filters
-- we already apply. The in-query filters are still preferred for correctness
-- and index usage; RLS catches anything that accidentally misses the filter.
--
-- Model:
--   - Every request that touches these tables should first set:
--       app.user_id          (uuid of the logged-in user)
--       app.user_territory   ('fun_coast' | 'space_coast' | 'both')
--       app.user_role        ('admin' | 'sales_rep' | 'technician')
--     via set_config(..., is_local=true) inside a transaction (see
--     src/db/withSession.ts).
--   - Admins see everything. Territory=both users see everything. A Fun Coast
--     or Space Coast user sees their own territory + unassigned.
--   - Write policies mirror read policies — you can't move a record out of
--     your territory, and you can't touch rows outside it.
--
-- Scripts (migrate / seed / import) run without setting session vars. For
-- those we grant a bypass: when app.user_role is unset or equals 'system',
-- RLS is skipped. In production on Replit this is fine because the
-- DATABASE_URL is the only connection path and scripts run locally/from the
-- Replit shell. On a hardened deployment we'd remove the 'system' escape
-- hatch and run scripts as a dedicated superuser role.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function app_current_territory() returns text
  language sql stable as $$
  select coalesce(nullif(current_setting('app.user_territory', true), ''), 'system')
$$;

create or replace function app_current_role() returns text
  language sql stable as $$
  select coalesce(nullif(current_setting('app.user_role', true), ''), 'system')
$$;

create or replace function app_current_user_id() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_bypass_rls() returns boolean
  language sql stable as $$
  -- Bypass when no session is bound (scripts) OR the user is admin / both.
  select
    app_current_role() = 'system'
    or app_current_role() = 'admin'
    or app_current_territory() = 'both'
$$;

-- A record is visible to the caller when:
--   * bypass (admin / both / system), OR
--   * the record's territory matches the caller's, OR
--   * the record is unassigned (routing queue is shared)
create or replace function app_can_see_territory(t text) returns boolean
  language sql stable as $$
  select app_bypass_rls()
      or t = 'unassigned'
      or t = app_current_territory()
$$;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

alter table accounts enable row level security;
alter table accounts force row level security;

drop policy if exists accounts_select on accounts;
create policy accounts_select on accounts
  for select using (app_can_see_territory(territory::text));

drop policy if exists accounts_insert on accounts;
create policy accounts_insert on accounts
  for insert with check (app_can_see_territory(territory::text));

drop policy if exists accounts_update on accounts;
create policy accounts_update on accounts
  for update
  using (app_can_see_territory(territory::text))
  with check (app_can_see_territory(territory::text));

drop policy if exists accounts_delete on accounts;
create policy accounts_delete on accounts
  for delete using (app_can_see_territory(territory::text));

-- ---------------------------------------------------------------------------
-- contacts — scoped via their parent account
-- ---------------------------------------------------------------------------

alter table contacts enable row level security;
alter table contacts force row level security;

drop policy if exists contacts_select on contacts;
create policy contacts_select on contacts
  for select using (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = contacts.account_id
        and app_can_see_territory(a.territory::text)
    )
  );

drop policy if exists contacts_mutate on contacts;
create policy contacts_mutate on contacts
  for all
  using (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = contacts.account_id
        and app_can_see_territory(a.territory::text)
    )
  )
  with check (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = contacts.account_id
        and app_can_see_territory(a.territory::text)
    )
  );

-- ---------------------------------------------------------------------------
-- opportunities — scoped via their parent account
-- ---------------------------------------------------------------------------

alter table opportunities enable row level security;
alter table opportunities force row level security;

drop policy if exists opportunities_select on opportunities;
create policy opportunities_select on opportunities
  for select using (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = opportunities.account_id
        and app_can_see_territory(a.territory::text)
    )
  );

drop policy if exists opportunities_mutate on opportunities;
create policy opportunities_mutate on opportunities
  for all
  using (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = opportunities.account_id
        and app_can_see_territory(a.territory::text)
    )
  )
  with check (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = opportunities.account_id
        and app_can_see_territory(a.territory::text)
    )
  );

-- ---------------------------------------------------------------------------
-- activities — scoped via their parent account
-- ---------------------------------------------------------------------------

alter table activities enable row level security;
alter table activities force row level security;

drop policy if exists activities_select on activities;
create policy activities_select on activities
  for select using (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = activities.account_id
        and app_can_see_territory(a.territory::text)
    )
  );

drop policy if exists activities_mutate on activities;
create policy activities_mutate on activities
  for all
  using (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = activities.account_id
        and app_can_see_territory(a.territory::text)
    )
  )
  with check (
    app_bypass_rls()
    or exists (
      select 1 from accounts a
      where a.id = activities.account_id
        and app_can_see_territory(a.territory::text)
    )
  );

-- ---------------------------------------------------------------------------
-- users / password_reset_tokens / audit_log
--   * users: readable to any authed caller (name display on cards, owner
--     pickers, etc.); writable only with bypass (admin / scripts).
--   * password_reset_tokens: bypass-only. Only the login/auth routes touch
--     these and they run server-side without a bound user yet.
--   * audit_log: insert from any scope; select bypass-only.
-- ---------------------------------------------------------------------------

alter table users enable row level security;
alter table users force row level security;

drop policy if exists users_select on users;
create policy users_select on users
  for select using (true);

drop policy if exists users_mutate on users;
create policy users_mutate on users
  for all
  using (app_bypass_rls())
  with check (app_bypass_rls());

alter table password_reset_tokens enable row level security;
alter table password_reset_tokens force row level security;

drop policy if exists password_reset_tokens_all on password_reset_tokens;
create policy password_reset_tokens_all on password_reset_tokens
  for all
  using (app_bypass_rls())
  with check (app_bypass_rls());

alter table audit_log enable row level security;
alter table audit_log force row level security;

drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log
  for select using (app_bypass_rls());

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (true);

-- ---------------------------------------------------------------------------
-- Supporting tables — read-anywhere, mutate-bypass-only.
-- ---------------------------------------------------------------------------

alter table city_county_mapping enable row level security;
alter table city_county_mapping force row level security;

drop policy if exists city_county_mapping_select on city_county_mapping;
create policy city_county_mapping_select on city_county_mapping
  for select using (true);

drop policy if exists city_county_mapping_mutate on city_county_mapping;
create policy city_county_mapping_mutate on city_county_mapping
  for all
  using (app_bypass_rls())
  with check (app_bypass_rls());

alter table service_pricing_config enable row level security;
alter table service_pricing_config force row level security;

drop policy if exists service_pricing_config_select on service_pricing_config;
create policy service_pricing_config_select on service_pricing_config
  for select using (true);

drop policy if exists service_pricing_config_mutate on service_pricing_config;
create policy service_pricing_config_mutate on service_pricing_config
  for all
  using (app_bypass_rls() and app_current_role() in ('system','admin'))
  with check (app_bypass_rls() and app_current_role() in ('system','admin'));

alter table known_competitors enable row level security;
alter table known_competitors force row level security;

drop policy if exists known_competitors_select on known_competitors;
create policy known_competitors_select on known_competitors
  for select using (true);

drop policy if exists known_competitors_mutate on known_competitors;
create policy known_competitors_mutate on known_competitors
  for all
  using (app_bypass_rls())
  with check (app_bypass_rls());
