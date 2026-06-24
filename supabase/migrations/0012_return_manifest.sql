-- =====================================================================
-- 0012_return_manifest.sql — return manifest tasks (SPEC.md §17.N, Workstream N)
--
-- The Segment-2 prevention mechanism: when an incoming relief boards, the
-- outgoing employee needs return transport arranged. A return_manifest_task is
-- created for the outgoing employee (deadline = boarded + 1 day @ 12:00 IST);
-- the catering manager files the ONGC return RFM or submits a reason, and an
-- overdue task raises an hr_manager Dashboard alert.
--
-- Also backfills app_user_installations, which was created by hand in Supabase
-- during Workstream M testing but never had a migration (referenced by
-- AuthContext / CMView for catering-manager installation scoping).
--
-- Conventions follow 0006: uuid PKs, timestamptz created_at/updated_at with the
-- set_updated_at() trigger, an index on every FK, open RLS for authenticated
-- (matches 0002_rls.sql / §2 / §16). Idempotent throughout.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Backfill: app_user_installations (created manually in Supabase during M)
-- ---------------------------------------------------------------------
create table if not exists app_user_installations (
  user_id         uuid not null references app_users(id) on delete cascade,
  installation_id uuid not null references installations(id) on delete cascade,
  primary key (user_id, installation_id)
);
create index if not exists idx_aui_installation_id on app_user_installations(installation_id);

alter table app_user_installations enable row level security;
drop policy if exists "authenticated_all_app_user_installations" on app_user_installations;
create policy "authenticated_all_app_user_installations" on app_user_installations
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Return manifest tasks
-- ---------------------------------------------------------------------
create table if not exists return_manifest_tasks (
  id                     uuid primary key default gen_random_uuid(),
  replacement_pairing_id uuid not null references replacement_pairings(id),
  outgoing_employee_id   uuid not null references employees(id),
  installation_id        uuid not null references installations(id),
  deadline               timestamptz not null,
  status                 text not null default 'pending'
                           check (status in ('pending','filed','submitted')),
  return_rfm_number      text,
  return_sortie_date     date,
  reason                 text,
  filed_by               uuid references app_users(id),
  submitted_by           uuid references app_users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_rmt_installation_status_deadline
  on return_manifest_tasks(installation_id, status, deadline);
create index if not exists idx_rmt_outgoing_employee_id
  on return_manifest_tasks(outgoing_employee_id);
-- One task per pairing — keeps createReturnTask idempotent if a boarded outcome
-- is recorded twice.
create unique index if not exists uq_rmt_replacement_pairing_id
  on return_manifest_tasks(replacement_pairing_id);

drop trigger if exists trg_return_manifest_tasks_updated_at on return_manifest_tasks;
create trigger trg_return_manifest_tasks_updated_at
  before update on return_manifest_tasks
  for each row execute function set_updated_at();

alter table return_manifest_tasks enable row level security;
drop policy if exists "authenticated_all_return_manifest_tasks" on return_manifest_tasks;
create policy "authenticated_all_return_manifest_tasks" on return_manifest_tasks
  for all to authenticated using (true) with check (true);
