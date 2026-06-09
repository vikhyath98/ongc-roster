-- =====================================================================
-- ONGC Rotation System — Row Level Security policies  (build step 3)
--
-- v1 policy (SPEC.md §2): all 10 users are trusted internal managers, so
-- ANY AUTHENTICATED USER may read and write EVERY table. Per-installation
-- scoping is deferred to phase 2 (SPEC.md §9).
--
-- Scoped to the `authenticated` role only — the `anon` role (not logged in)
-- has no policy and is therefore denied. RLS is already enabled on the
-- tables; the `enable row level security` lines below are harmless no-ops
-- that keep this migration self-contained and re-runnable.
--
-- Safe to run more than once (drop-then-create).
-- =====================================================================

-- categories
alter table categories enable row level security;
drop policy if exists "authenticated_all_categories" on categories;
create policy "authenticated_all_categories" on categories
  for all to authenticated using (true) with check (true);

-- designations
alter table designations enable row level security;
drop policy if exists "authenticated_all_designations" on designations;
create policy "authenticated_all_designations" on designations
  for all to authenticated using (true) with check (true);

-- installations
alter table installations enable row level security;
drop policy if exists "authenticated_all_installations" on installations;
create policy "authenticated_all_installations" on installations
  for all to authenticated using (true) with check (true);

-- app_users
alter table app_users enable row level security;
drop policy if exists "authenticated_all_app_users" on app_users;
create policy "authenticated_all_app_users" on app_users
  for all to authenticated using (true) with check (true);

-- employees
alter table employees enable row level security;
drop policy if exists "authenticated_all_employees" on employees;
create policy "authenticated_all_employees" on employees
  for all to authenticated using (true) with check (true);

-- document_types
alter table document_types enable row level security;
drop policy if exists "authenticated_all_document_types" on document_types;
create policy "authenticated_all_document_types" on document_types
  for all to authenticated using (true) with check (true);

-- document_type_designations
alter table document_type_designations enable row level security;
drop policy if exists "authenticated_all_document_type_designations" on document_type_designations;
create policy "authenticated_all_document_type_designations" on document_type_designations
  for all to authenticated using (true) with check (true);

-- employee_documents
alter table employee_documents enable row level security;
drop policy if exists "authenticated_all_employee_documents" on employee_documents;
create policy "authenticated_all_employee_documents" on employee_documents
  for all to authenticated using (true) with check (true);

-- rotation_log
alter table rotation_log enable row level security;
drop policy if exists "authenticated_all_rotation_log" on rotation_log;
create policy "authenticated_all_rotation_log" on rotation_log
  for all to authenticated using (true) with check (true);

-- installation_requirements
alter table installation_requirements enable row level security;
drop policy if exists "authenticated_all_installation_requirements" on installation_requirements;
create policy "authenticated_all_installation_requirements" on installation_requirements
  for all to authenticated using (true) with check (true);

-- availability
alter table availability enable row level security;
drop policy if exists "authenticated_all_availability" on availability;
create policy "authenticated_all_availability" on availability
  for all to authenticated using (true) with check (true);

-- call_log
alter table call_log enable row level security;
drop policy if exists "authenticated_all_call_log" on call_log;
create policy "authenticated_all_call_log" on call_log
  for all to authenticated using (true) with check (true);

-- penalty_log
alter table penalty_log enable row level security;
drop policy if exists "authenticated_all_penalty_log" on penalty_log;
create policy "authenticated_all_penalty_log" on penalty_log
  for all to authenticated using (true) with check (true);

-- app_config
alter table app_config enable row level security;
drop policy if exists "authenticated_all_app_config" on app_config;
create policy "authenticated_all_app_config" on app_config
  for all to authenticated using (true) with check (true);
