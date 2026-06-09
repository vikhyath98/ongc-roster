-- =====================================================================
-- ONGC Offshore Workforce Rotation System — initial schema
-- Source of truth: SPEC.md §4. One migration creating all tables.
--
-- Conventions (SPEC.md §4):
--   * uuid PKs via gen_random_uuid()
--   * timestamptz timestamps; created_at/updated_at on mutable tables
--   * FKs with sensible on-delete behaviour
--   * index on every FK + partial index on rotation_log(sign_off_date) null
--
-- RLS policies are intentionally NOT in this migration — they are added in
-- 0002 (build step 3), per the build sequence in SPEC.md §7.
-- =====================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- updated_at trigger helper (applied to mutable tables below)
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Reference: categories
-- ---------------------------------------------------------------------
create table categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique  -- Unskilled, Semi-skilled, Skilled, Outsourced
);

-- ---------------------------------------------------------------------
-- Reference: designations (role within a category)
-- ---------------------------------------------------------------------
create table designations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category_id  uuid not null references categories(id),
  created_at   timestamptz not null default now(),
  unique (name, category_id)
);
create index idx_designations_category_id on designations(category_id);

-- ---------------------------------------------------------------------
-- Installations: platforms and rigs
-- ---------------------------------------------------------------------
create table installations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  type        text not null check (type in ('platform','rig')),
  is_active   boolean not null default true,  -- toggleable in Configuration
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_installations_updated_at
  before update on installations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Managers (linked to Supabase auth.users)
-- ---------------------------------------------------------------------
create table app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        text not null default 'manager' check (role in ('admin','manager')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
create table employees (
  id                       uuid primary key default gen_random_uuid(),
  emp_id                   text not null unique,        -- ID managers type/scan
  full_name                text not null,
  designation_id           uuid not null references designations(id),
  phone                    text,
  employment_status        text not null default 'active'
                             check (employment_status in ('active','inactive')),
  current_installation_id  uuid references installations(id),  -- null = on base
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index idx_employees_designation_id on employees(designation_id);
create index idx_employees_current_installation_id on employees(current_installation_id);
create trigger trg_employees_updated_at
  before update on employees
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Document type definitions (configurable; universal or designation-specific)
-- ---------------------------------------------------------------------
create table document_types (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null unique,
  is_required            boolean not null default true,
  applies_to_all         boolean not null default false,  -- true = every employee
  default_validity_days  int,                             -- null = no auto-expiry
  created_at             timestamptz not null default now()
);

-- Which specific designations require a non-universal document (many-to-many).
create table document_type_designations (
  document_type_id  uuid not null references document_types(id) on delete cascade,
  designation_id    uuid not null references designations(id) on delete cascade,
  primary key (document_type_id, designation_id)
);
create index idx_doc_type_desig_designation_id on document_type_designations(designation_id);

-- ---------------------------------------------------------------------
-- Per-employee document state (the checklist)
-- ---------------------------------------------------------------------
create table employee_documents (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id) on delete cascade,
  document_type_id  uuid not null references document_types(id),
  status            text not null default 'pending'
                      check (status in ('pending','submitted','verified')),
  issue_date        date,
  expiry_date       date,
  verified_by       uuid references app_users(id),
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, document_type_id)
);
create index idx_employee_documents_employee_id on employee_documents(employee_id);
create index idx_employee_documents_document_type_id on employee_documents(document_type_id);
create index idx_employee_documents_verified_by on employee_documents(verified_by);
create trigger trg_employee_documents_updated_at
  before update on employee_documents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Rotation log: ONE ROW PER BOARDING/DEBOARDING PAIR
-- ---------------------------------------------------------------------
create table rotation_log (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references employees(id),
  installation_id        uuid not null references installations(id),
  sign_on_date           date not null,
  sign_off_date          date,                  -- null = currently offshore
  expected_rotation_date date,                  -- default sign_on + max_service_days
  onboarded_by           uuid references app_users(id),
  offboarded_by          uuid references app_users(id),
  remarks                text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_rotation_log_employee_id on rotation_log(employee_id);
create index idx_rotation_log_installation_id on rotation_log(installation_id);
create index idx_rotation_log_onboarded_by on rotation_log(onboarded_by);
create index idx_rotation_log_offboarded_by on rotation_log(offboarded_by);
-- "currently offshore" query: open stints only
create index idx_rotation_log_open_stints on rotation_log(sign_off_date)
  where sign_off_date is null;
create trigger trg_rotation_log_updated_at
  before update on rotation_log
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- How many of each designation each installation needs
-- ---------------------------------------------------------------------
create table installation_requirements (
  id               uuid primary key default gen_random_uuid(),
  installation_id  uuid not null references installations(id) on delete cascade,
  designation_id   uuid not null references designations(id),
  required_count   int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (installation_id, designation_id)
);
create index idx_install_req_installation_id on installation_requirements(installation_id);
create index idx_install_req_designation_id on installation_requirements(designation_id);
create trigger trg_install_req_updated_at
  before update on installation_requirements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Current availability/confirmation state per base employee (one row each)
-- ---------------------------------------------------------------------
create table availability (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id) on delete cascade unique,
  confirmed           boolean not null default false,
  confirmed_at        timestamptz,
  confirmed_for_date  date,
  expires_at          timestamptz,
  call_count          int not null default 0,
  last_call_at        timestamptz,
  last_call_outcome   text check (last_call_outcome in
                        ('no_answer','call_back','confirmed','declined')),
  updated_by          uuid references app_users(id),
  updated_at          timestamptz not null default now()
);
create index idx_availability_updated_by on availability(updated_by);
create trigger trg_availability_updated_at
  before update on availability
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Full call history
-- ---------------------------------------------------------------------
create table call_log (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  called_by    uuid references app_users(id),
  called_at    timestamptz not null default now(),
  outcome      text not null check (outcome in
                 ('no_answer','call_back','confirmed','declined')),
  notes        text
);
create index idx_call_log_employee_id on call_log(employee_id);
create index idx_call_log_called_by on call_log(called_by);

-- ---------------------------------------------------------------------
-- Penalty log (auto-computed from day count; reconciled later by a manager)
-- One row per offshore stint that crosses the hard threshold.
-- ---------------------------------------------------------------------
create table penalty_log (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references employees(id),
  installation_id        uuid not null references installations(id),
  rotation_log_id        uuid references rotation_log(id) unique,  -- one per stint
  days_over              int not null default 0,
  daily_penalty_rate     numeric not null default 1000,
  total_penalty          numeric not null default 0,
  status                 text not null default 'unreconciled'
                           check (status in ('unreconciled','reconciled')),
  reconciled_by          uuid references app_users(id),
  reconciled_at          timestamptz,
  reconciliation_remark  text,  -- REQUIRED (non-empty) when status = 'reconciled'
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_penalty_log_employee_id on penalty_log(employee_id);
create index idx_penalty_log_installation_id on penalty_log(installation_id);
create index idx_penalty_log_reconciled_by on penalty_log(reconciled_by);
-- Guard the §3.2/§6.7 rule at the data layer: reconciled rows need a remark.
alter table penalty_log add constraint penalty_reconciled_needs_remark
  check (
    status <> 'reconciled'
    or (reconciliation_remark is not null and length(btrim(reconciliation_remark)) > 0)
  );
create trigger trg_penalty_log_updated_at
  before update on penalty_log
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Configurable thresholds and rates
-- ---------------------------------------------------------------------
create table app_config (
  key         text primary key,
  value       text not null,
  updated_by  uuid references app_users(id),
  updated_at  timestamptz not null default now()
);
create index idx_app_config_updated_by on app_config(updated_by);
create trigger trg_app_config_updated_at
  before update on app_config
  for each row execute function set_updated_at();
