-- =====================================================================
-- SCENARIO 1 — No pairing at all  (SPEC.md §14.6)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   One offshore employee, clearly over day 70 (80 days served), with NO
--   manifest_request_item ever naming them and NO replacement_pairings row.
--   No relief was ever in motion.
--
-- WHAT TO DO IN THE APP:
--   1. Board → Offboard tab.
--   2. Find "TEST-SCENARIO-1 Employee" (designation Cook, 📍 ICP, ~80d served).
--   3. Select them, leave the sign-off date as today, click Offboard.
--   4. The "Overstay attribution" modal opens.
--
-- EXPECTED MODAL OUTPUT:
--   * Title: "Overstay attribution — TEST-SCENARIO-1 Employee"
--   * Segment 1 — wait for relief: 10d, default = SKFS
--       (no relief was ever boarded → the whole overstay is segment 1, SKFS)
--   * Segment 2: NOT shown (0 days).
--
-- HOW TO CONFIRM IT PASSED:
--   * The modal shows Segment 1 = 10d defaulting to SKFS, and no Segment 2.
--   * Confirm the sign-off; the modal closes and the offboard completes.
--   * Then run the VERIFY query at the bottom — one overstay_attributions row
--     with segment_1_days = 10, segment_1_attribution = 'skfs',
--     segment_2_days = 0, segment_2_attribution = NULL.
--
-- Day math (independent of run date): sign_on = today − 79 ⇒ 80 days served;
-- hard threshold (day 70) = today − 10; entire overstay = 10 days.
-- Independently runnable; cleans up its own TEST-S1-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (FK-safe order) -------------------------
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-S1-%')
     or employee_id in (select id from employees where emp_id like 'TEST-S1-%');
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S1-%'));
delete from understay_records
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S1-%'));
delete from penalty_log
  where employee_id in (select id from employees where emp_id like 'TEST-S1-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-S1-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-S1-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-S1-%');
delete from manifest_requests where notes like 'TEST-S1-%';
delete from rfms where rfm_number like 'TEST-S1-%';
delete from employees where emp_id like 'TEST-S1-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out     uuid;
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S1-OUT', 'TEST-SCENARIO-1 Employee', v_desig, v_install, 'active')
  returning id into v_out;

  -- Open (currently offshore) stint, 80 days served, no relief in motion.
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 79, (current_date - 79) + 70);
end $$;

-- ---- VERIFY (run AFTER offboarding in the app) ---------------------
-- select oa.segment_1_days, oa.segment_1_attribution,
--        oa.segment_2_days, oa.segment_2_attribution
-- from overstay_attributions oa
-- join rotation_log rl on rl.id = oa.rotation_log_id
-- join employees e on e.id = rl.employee_id
-- where e.emp_id = 'TEST-S1-OUT';
-- Expect: 10 | skfs | 0 | (null)
