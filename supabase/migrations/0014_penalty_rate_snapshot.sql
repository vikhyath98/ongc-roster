-- =====================================================================
-- 0014_penalty_rate_snapshot.sql
--
-- 1. Snapshot the daily penalty rate on each overstay attribution at record
--    time, so historical dispute/penalty amounts don't shift if the live
--    app_config rate changes later (SPEC.md §15 item 4).
-- 2. Add an optional alternate phone number on employees.
--
-- Both nullable, no constraints. Idempotent.
-- =====================================================================

alter table overstay_attributions
  add column if not exists daily_penalty_rate numeric(10,2);

alter table employees
  add column if not exists alternate_phone text;
