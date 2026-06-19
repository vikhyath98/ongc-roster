-- =====================================================================
-- SCENARIO 5 — First attempt succeeds, but manifest filed AFTER day 65
-- (SPEC.md §14.6)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   An offshore employee over day 70 (80 days served). Relief boarded on the
--   FIRST try (no prior failed attempt), but the manifest request was filed
--   only when the employee was already on day 67 — outside the safe 56–65
--   window. With no prior failure to point at, the segment-1 default falls
--   back to the filing date: filed after day 65 ⇒ SKFS (we manifested late).
--
-- WHAT TO DO IN THE APP:
--   1. Board → Offboard tab.
--   2. Find "TEST-SCENARIO-5 Employee (overstay)" (Cook, 📍 ICP, ~80d served).
--   3. Select, leave sign-off date as today, click Offboard.
--   4. The "Overstay attribution" modal opens.
--
-- EXPECTED MODAL OUTPUT:
--   * Segment 1 — wait for relief: 6d, default = SKFS
--       (no prior failed attempt; original request filed on day 67, after
--        warning_day 65 → defaults to SKFS)
--   * Segment 2 — after relief arrived: 4d, default = ONGC
--
-- HOW TO CONFIRM IT PASSED:
--   * Modal shows Seg 1 = 6d / SKFS and Seg 2 = 4d / ONGC.
--     (Contrast with Scenario 4, where the in-window filing would default
--      Seg 1 to ONGC — here the late filing flips it to SKFS.)
--   * Confirm sign-off; run the VERIFY query: segment_1_days=6,
--     segment_1_attribution='skfs', segment_2_days=4, segment_2_attribution='ongc'.
--
-- Day math (vs today): sign_on = today−79 ⇒ 80d served; day-70 threshold =
-- today−10; request filed = today−13 (= day 67, after 65); relief boarded
-- (RFM sortie) = today−4.  Seg1 = (−4)−(−10) = 6d; Seg2 = today−(today−4) = 4d.
-- Independently runnable; cleans up its own TEST-S5-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (correct FK dependency order) -----------
-- 1. overstay_attributions -> rotation_log, replacement_pairings
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S5-%'));
-- 2. understay_records -> rotation_log, employees
delete from understay_records
  where employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 3. clear rfm_line_items.rotation_log_id before rotation_log is deleted
update rfm_line_items set rotation_log_id = null
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S5-%'));
-- 4. rfm_line_items -> rfms, employees
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-S5-%')
     or employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 5. replacement_pairings -> employees (self-ref retry removed in one delete)
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-S5-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 6. rfms -> manifest_requests
delete from rfms where rfm_number like 'TEST-S5-%';
-- 7. manifest_request_items -> manifest_requests, employees
delete from manifest_request_items
  where employee_id in (select id from employees where emp_id like 'TEST-S5-%')
     or replacing_employee_id in (select id from employees where emp_id like 'TEST-S5-%')
     or manifest_request_id in (select id from manifest_requests where notes like 'TEST-S5-%');
-- 8. manifest_requests
delete from manifest_requests where notes like 'TEST-S5-%';
-- 9. availability -> employees
delete from availability
  where employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 10. call_log -> employees
delete from call_log
  where employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 11. employee_documents -> employees
delete from employee_documents
  where employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 12. rotation_log -> employees
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-S5-%');
-- 13. employees
delete from employees where emp_id like 'TEST-S5-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out     uuid;
  v_in      uuid;
  v_req     uuid;  v_item uuid;  v_rfm uuid;  v_line uuid;  v_rot_in uuid;
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S5-OUT', 'TEST-SCENARIO-5 Employee (overstay)', v_desig, v_install, 'active')
  returning id into v_out;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S5-IN', 'TEST-SCENARIO-5 Relief', v_desig, v_install, 'active')
  returning id into v_in;

  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 79, (current_date - 79) + 70);

  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_in, v_install, current_date - 4, (current_date - 4) + 70)
  returning id into v_rot_in;

  -- Filed late (day 67, after warning_day 65), first try, boarded.
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 13, 'approved', 'TEST-S5 (late filing, boarded first try)')
  returning id into v_req;

  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in, v_out)
  returning id into v_item;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-S5-RFM', v_req, v_install, current_date - 4)
  returning id into v_rfm;

  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at, rotation_log_id)
  values (v_rfm, v_in, 'boarded', now(), v_rot_in)
  returning id into v_line;

  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id,
     rfm_line_item_id, status, relief_deadline)
  values (v_item, v_out, v_in, v_line, 'boarded', (current_date - 4) + 1);
end $$;

-- ---- VERIFY (run AFTER offboarding in the app) ---------------------
-- select oa.segment_1_days, oa.segment_1_attribution,
--        oa.segment_2_days, oa.segment_2_attribution
-- from overstay_attributions oa
-- join rotation_log rl on rl.id = oa.rotation_log_id
-- join employees e on e.id = rl.employee_id
-- where e.emp_id = 'TEST-S5-OUT';
-- Expect: 6 | skfs | 4 | ongc
