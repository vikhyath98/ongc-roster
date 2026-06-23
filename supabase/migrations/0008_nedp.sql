-- =====================================================================
-- 0008_nedp.sql — NEDP pass (SPEC.md §17.J, Workstream J)
-- NEDP is modelled as a first-class employee attribute (not a document
-- record): a unique pass number + its validity date, plus a config-driven
-- default validity period. Additive and idempotent.
-- =====================================================================

alter table employees
  add column if not exists nedp_number text,
  add column if not exists nedp_valid_until date;

-- Unique pass number (nullable — many employees have none yet). Guarded so the
-- migration is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_nedp_number_unique'
  ) then
    alter table employees
      add constraint employees_nedp_number_unique unique (nedp_number);
  end if;
end $$;

-- Default validity period for a freshly issued NEDP (days).
insert into app_config (key, value) values
  ('nedp_validity_days', '365')
on conflict (key) do nothing;
