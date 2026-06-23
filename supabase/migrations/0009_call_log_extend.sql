-- =====================================================================
-- 0009_call_log_extend.sql — extend call_log for Model A (SPEC.md §17.L)
-- The existing v1 call_log becomes the per-call record for the two-step
-- "create call, then set outcome" flow: outcome is now nullable (set after
-- the call), gains the 'unreachable' value, and carries the commitment
-- details captured on a confirmed call. Additive + idempotent.
-- =====================================================================

-- Outcome is recorded after the call is placed, so it may be null initially.
alter table call_log
  alter column outcome drop not null;

-- Widen the allowed outcomes with 'unreachable' (keep 'call_back' spelling).
alter table call_log
  drop constraint if exists call_log_outcome_check;
alter table call_log
  add constraint call_log_outcome_check
  check (outcome in (
    'no_answer','call_back','confirmed','declined','unreachable'
  ));

-- Commitment details captured when a call is confirmed.
alter table call_log
  add column if not exists commitment_date date,
  add column if not exists hometown text,
  add column if not exists travel_days smallint check (travel_days >= 0);

-- History queries read newest-first per employee.
create index if not exists call_log_employee_called_at_idx
  on call_log (employee_id, called_at desc);

-- availability mirrors the last outcome, so it must accept 'unreachable' too.
alter table availability
  drop constraint if exists availability_last_call_outcome_check;
alter table availability
  add constraint availability_last_call_outcome_check
  check (last_call_outcome in (
    'no_answer','call_back','confirmed','declined','unreachable'
  ));
