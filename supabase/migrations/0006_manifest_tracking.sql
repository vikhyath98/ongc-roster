-- =====================================================================
-- ONGC Rotation System — manifestation tracking
--
-- Adds the manifest → RFM → boarding pipeline, relief pairing, two-segment
-- overstay attribution, understay cost tracking, plus supporting columns on
-- existing tables (base location, manual exceptions, document DOB/number).
--
-- Conventions follow 0001_init.sql: uuid PKs via gen_random_uuid(),
-- timestamptz created_at/updated_at with the set_updated_at() trigger, an
-- index on every FK. RLS (any authenticated user) is added at the bottom,
-- matching 0002_rls.sql.
--
-- Run AFTER seed.sql (it updates the Aadhaar/PAN/Passport rows). Safe to run
-- more than once (if-not-exists / drop-then-create throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Manifest requests (what SKFS asks ONGC to mobilise)
-- ---------------------------------------------------------------------
create table if not exists manifest_requests (
  id               uuid primary key default gen_random_uuid(),
  installation_id  uuid not null references installations(id),
  request_date     date not null,
  requested_by     uuid references app_users(id),
  notes            text,
  status           text not null default 'sent'
                     check (status in ('sent','partially_approved','approved','rejected')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_manifest_requests_installation_id on manifest_requests(installation_id);
create index if not exists idx_manifest_requests_requested_by on manifest_requests(requested_by);
drop trigger if exists trg_manifest_requests_updated_at on manifest_requests;
create trigger trg_manifest_requests_updated_at
  before update on manifest_requests
  for each row execute function set_updated_at();

-- One incoming (relief) employee per line item, optionally replacing an
-- outgoing employee currently offshore.
create table if not exists manifest_request_items (
  id                     uuid primary key default gen_random_uuid(),
  manifest_request_id    uuid not null references manifest_requests(id) on delete cascade,
  employee_id            uuid not null references employees(id),
  replacing_employee_id  uuid references employees(id),
  reason                 text,
  is_emergency_exception boolean not null default false,
  exception_reason       text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_mri_manifest_request_id on manifest_request_items(manifest_request_id);
create index if not exists idx_mri_employee_id on manifest_request_items(employee_id);
create index if not exists idx_mri_replacing_employee_id on manifest_request_items(replacing_employee_id);

-- ---------------------------------------------------------------------
-- RFMs (the actual sortie manifests ONGC issues) + their line items
-- ---------------------------------------------------------------------
create table if not exists rfms (
  id                    uuid primary key default gen_random_uuid(),
  rfm_number            text not null unique,
  manifest_request_id   uuid references manifest_requests(id),
  installation_id       uuid not null references installations(id),
  sortie_date           date not null,
  scheduled_dep_time    time,
  scheduled_report_time time,
  mode_of_journey       text not null default 'Air'
                          check (mode_of_journey in ('Air','Sea','Other')),
  received_at           timestamptz default now(),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_rfms_manifest_request_id on rfms(manifest_request_id);
create index if not exists idx_rfms_installation_id on rfms(installation_id);
drop trigger if exists trg_rfms_updated_at on rfms;
create trigger trg_rfms_updated_at
  before update on rfms
  for each row execute function set_updated_at();

create table if not exists rfm_line_items (
  id                  uuid primary key default gen_random_uuid(),
  rfm_id              uuid not null references rfms(id) on delete cascade,
  employee_id         uuid not null references employees(id),
  vendor_code         text,
  outcome             text not null default 'listed'
                        check (outcome in ('listed','boarded','dropped','no_show')),
  outcome_reason      text,
  outcome_recorded_at timestamptz,
  outcome_recorded_by uuid references app_users(id),
  rotation_log_id     uuid references rotation_log(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_rli_rfm_id on rfm_line_items(rfm_id);
create index if not exists idx_rli_employee_id on rfm_line_items(employee_id);
create index if not exists idx_rli_outcome_recorded_by on rfm_line_items(outcome_recorded_by);
create index if not exists idx_rli_rotation_log_id on rfm_line_items(rotation_log_id);
drop trigger if exists trg_rfm_line_items_updated_at on rfm_line_items;
create trigger trg_rfm_line_items_updated_at
  before update on rfm_line_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Replacement pairings (links an outgoing employee to their relief, across
-- retries). Manual-exception pairings carry a null manifest_request_item_id.
-- ---------------------------------------------------------------------
create table if not exists replacement_pairings (
  id                       uuid primary key default gen_random_uuid(),
  manifest_request_item_id uuid references manifest_request_items(id) on delete set null,
  outgoing_employee_id     uuid not null references employees(id),
  incoming_employee_id     uuid not null references employees(id),
  retry_of_pairing_id      uuid references replacement_pairings(id),
  rfm_line_item_id         uuid references rfm_line_items(id) on delete set null,
  status                   text not null default 'pending'
                             check (status in ('pending','rfm_listed','boarded','dropped','no_show')),
  relief_deadline          date,
  consumed_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_rp_manifest_request_item_id on replacement_pairings(manifest_request_item_id);
create index if not exists idx_rp_outgoing_employee_id on replacement_pairings(outgoing_employee_id);
create index if not exists idx_rp_incoming_employee_id on replacement_pairings(incoming_employee_id);
create index if not exists idx_rp_retry_of_pairing_id on replacement_pairings(retry_of_pairing_id);
create index if not exists idx_rp_rfm_line_item_id on replacement_pairings(rfm_line_item_id);
drop trigger if exists trg_replacement_pairings_updated_at on replacement_pairings;
create trigger trg_replacement_pairings_updated_at
  before update on replacement_pairings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Overstay attribution (two segments) — one row per overstayed stint.
-- Additive on top of the existing penalty_exposure computation.
-- ---------------------------------------------------------------------
create table if not exists overstay_attributions (
  id                     uuid primary key default gen_random_uuid(),
  rotation_log_id        uuid not null unique references rotation_log(id),
  replacement_pairing_id uuid references replacement_pairings(id),
  segment_1_days         int not null default 0,
  segment_1_attribution  text check (segment_1_attribution in ('ongc','skfs')),
  segment_1_overridden   boolean not null default false,
  segment_1_remark       text,
  segment_2_days         int not null default 0,
  segment_2_attribution  text check (segment_2_attribution in ('ongc','skfs')),
  segment_2_overridden   boolean not null default false,
  segment_2_remark       text,
  created_by             uuid references app_users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_oa_replacement_pairing_id on overstay_attributions(replacement_pairing_id);
create index if not exists idx_oa_created_by on overstay_attributions(created_by);
drop trigger if exists trg_overstay_attributions_updated_at on overstay_attributions;
create trigger trg_overstay_attributions_updated_at
  before update on overstay_attributions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Understay records — captured when an employee signs off under the minimum.
-- Costs snapshot app_config at calc time (rates are placeholders for now).
-- ---------------------------------------------------------------------
create table if not exists understay_records (
  id              uuid primary key default gen_random_uuid(),
  rotation_log_id uuid not null references rotation_log(id),
  employee_id     uuid not null references employees(id),
  days_short      int not null,
  reason          text,
  fixed_cost      numeric not null default 0,
  daily_rate      numeric not null default 0,
  total_cost      numeric not null default 0,
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_ur_rotation_log_id on understay_records(rotation_log_id);
create index if not exists idx_ur_employee_id on understay_records(employee_id);
create index if not exists idx_ur_created_by on understay_records(created_by);

-- ---------------------------------------------------------------------
-- New columns on existing tables
-- ---------------------------------------------------------------------

-- Documents: a per-document number (tracks_number) and the DOB printed on
-- THIS document. tracks_number is independent of tracks_dates.
alter table document_types
  add column if not exists tracks_number boolean not null default false;

alter table employee_documents
  add column if not exists date_of_birth date;

-- Identity documents carry a number. Passport carries both a number and dates
-- (its tracks_dates stays true); Aadhaar/PAN remain number-only.
update document_types
  set tracks_number = true
  where name in ('Aadhaar Card', 'PAN Card', 'Passport');

-- Employees: where they sit when on base, recall lead time, no-show counter.
alter table employees
  add column if not exists base_location_type text
    check (base_location_type in ('guesthouse','hometown'));
alter table employees
  add column if not exists recall_lead_time_days int;
alter table employees
  add column if not exists no_show_count int not null default 0;

-- Rotation log: flag boardings made outside the formal manifest flow.
alter table rotation_log
  add column if not exists is_manual_exception boolean not null default false;
alter table rotation_log
  add column if not exists manual_exception_reason text;

-- ---------------------------------------------------------------------
-- New app_config keys (understay rates are PLACEHOLDERS — surface as such)
-- ---------------------------------------------------------------------
insert into app_config (key, value) values
  ('relief_grace_period_days', '1'),
  ('understay_fixed_cost',     '0'),
  ('understay_daily_rate',     '0')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- RLS — any authenticated user reads/writes (matches 0002_rls.sql)
-- ---------------------------------------------------------------------
alter table manifest_requests enable row level security;
drop policy if exists "authenticated_all_manifest_requests" on manifest_requests;
create policy "authenticated_all_manifest_requests" on manifest_requests
  for all to authenticated using (true) with check (true);

alter table manifest_request_items enable row level security;
drop policy if exists "authenticated_all_manifest_request_items" on manifest_request_items;
create policy "authenticated_all_manifest_request_items" on manifest_request_items
  for all to authenticated using (true) with check (true);

alter table rfms enable row level security;
drop policy if exists "authenticated_all_rfms" on rfms;
create policy "authenticated_all_rfms" on rfms
  for all to authenticated using (true) with check (true);

alter table rfm_line_items enable row level security;
drop policy if exists "authenticated_all_rfm_line_items" on rfm_line_items;
create policy "authenticated_all_rfm_line_items" on rfm_line_items
  for all to authenticated using (true) with check (true);

alter table replacement_pairings enable row level security;
drop policy if exists "authenticated_all_replacement_pairings" on replacement_pairings;
create policy "authenticated_all_replacement_pairings" on replacement_pairings
  for all to authenticated using (true) with check (true);

alter table overstay_attributions enable row level security;
drop policy if exists "authenticated_all_overstay_attributions" on overstay_attributions;
create policy "authenticated_all_overstay_attributions" on overstay_attributions
  for all to authenticated using (true) with check (true);

alter table understay_records enable row level security;
drop policy if exists "authenticated_all_understay_records" on understay_records;
create policy "authenticated_all_understay_records" on understay_records
  for all to authenticated using (true) with check (true);
