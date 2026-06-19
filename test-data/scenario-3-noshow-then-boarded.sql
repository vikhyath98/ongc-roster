-- =====================================================================
-- SCENARIO 3 — Relief NO-SHOWED, then retried and boarded  (SPEC.md §14.6)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   Same shape as Scenario 2, but the first attempt's RFM line outcome is
--   'no_show' and the first pairing status is 'no_show' (the seat was there,
--   the employee didn't show). Attempt 2 boards as the active pairing.
--   Walking the retry chain finds a prior 'no_show' — which defaults the
--   first segment to SKFS (our reliability problem), NOT ONGC.
--
-- WHAT TO DO IN THE APP:
--   1. Board → Offboard tab.
--   2. Find "TEST-SCENARIO-3 Employee (overstay)" (Cook, 📍 ICP, ~80d served).
--   3. Select, leave sign-off date as today, click Offboard.
--   4. The "Overstay attribution" modal opens.
--
-- EXPECTED MODAL OUTPUT:
--   * Segment 1 — wait for relief: 6d, default = SKFS
--       (prior attempt was a NO-SHOW → our fault, not ONGC's)
--   * Segment 2 — after relief arrived: 4d, default = ONGC
--
-- HOW TO CONFIRM IT PASSED:
--   * Modal shows Seg 1 = 6d / SKFS and Seg 2 = 4d / ONGC by default.
--     (This is the ONLY difference from Scenario 2: Seg 1 is SKFS, not ONGC.)
--   * Confirm sign-off; run the VERIFY query: segment_1_days=6,
--     segment_1_attribution='skfs', segment_2_days=4, segment_2_attribution='ongc'.
--
-- Day math identical to Scenario 2: sign_on = today−79; day-70 threshold =
-- today−10; relief boarded (RFM sortie) = today−4 ⇒ Seg1 6d, Seg2 4d.
-- Independently runnable; cleans up its own TEST-S3-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (correct FK dependency order) -----------
-- 1. overstay_attributions -> rotation_log, replacement_pairings
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S3-%'));
-- 2. understay_records -> rotation_log, employees
delete from understay_records
  where employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 3. clear rfm_line_items.rotation_log_id before rotation_log is deleted
update rfm_line_items set rotation_log_id = null
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S3-%'));
-- 4. rfm_line_items -> rfms, employees
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-S3-%')
     or employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 5. replacement_pairings -> employees (self-ref retry removed in one delete)
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-S3-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 6. rfms -> manifest_requests
delete from rfms where rfm_number like 'TEST-S3-%';
-- 7. manifest_request_items -> manifest_requests, employees
delete from manifest_request_items
  where employee_id in (select id from employees where emp_id like 'TEST-S3-%')
     or replacing_employee_id in (select id from employees where emp_id like 'TEST-S3-%')
     or manifest_request_id in (select id from manifest_requests where notes like 'TEST-S3-%');
-- 8. manifest_requests
delete from manifest_requests where notes like 'TEST-S3-%';
-- 9. availability -> employees
delete from availability
  where employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 10. call_log -> employees
delete from call_log
  where employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 11. employee_documents -> employees
delete from employee_documents
  where employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 12. rotation_log -> employees
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-S3-%');
-- 13. employees
delete from employees where emp_id like 'TEST-S3-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out     uuid;
  v_in      uuid;
  v_req1    uuid;   v_item1 uuid;  v_rfm1 uuid;  v_line1 uuid;  v_pair1 uuid;
  v_req2    uuid;   v_item2 uuid;  v_rfm2 uuid;  v_line2 uuid;
  v_rot_in  uuid;
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S3-OUT', 'TEST-SCENARIO-3 Employee (overstay)', v_desig, v_install, 'active')
  returning id into v_out;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S3-IN', 'TEST-SCENARIO-3 Relief', v_desig, v_install, 'active')
  returning id into v_in;

  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 79, (current_date - 79) + 70);

  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_in, v_install, current_date - 4, (current_date - 4) + 70)
  returning id into v_rot_in;

  -- ---- Attempt 1: requested, RFM-listed, NO-SHOW --------------------
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 12, 'sent', 'TEST-S3-attempt1 (no_show)')
  returning id into v_req1;

  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req1, v_in, v_out)
  returning id into v_item1;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-S3-RFM1', v_req1, v_install, current_date - 8)
  returning id into v_rfm1;

  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfm1, v_in, 'no_show', now())
  returning id into v_line1;

  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id,
     rfm_line_item_id, status)
  values (v_item1, v_out, v_in, v_line1, 'no_show')
  returning id into v_pair1;

  -- ---- Attempt 2: retry, RFM-listed, BOARDED (active pairing) -------
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 6, 'approved', 'TEST-S3-attempt2 (boarded)')
  returning id into v_req2;

  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req2, v_in, v_out)
  returning id into v_item2;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-S3-RFM2', v_req2, v_install, current_date - 4)
  returning id into v_rfm2;

  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at, rotation_log_id)
  values (v_rfm2, v_in, 'boarded', now(), v_rot_in)
  returning id into v_line2;

  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id,
     retry_of_pairing_id, rfm_line_item_id, status, relief_deadline)
  values (v_item2, v_out, v_in, v_pair1, v_line2, 'boarded', (current_date - 4) + 1);
end $$;

-- ---- VERIFY (run AFTER offboarding in the app) ---------------------
-- select oa.segment_1_days, oa.segment_1_attribution,
--        oa.segment_2_days, oa.segment_2_attribution
-- from overstay_attributions oa
-- join rotation_log rl on rl.id = oa.rotation_log_id
-- join employees e on e.id = rl.employee_id
-- where e.emp_id = 'TEST-S3-OUT';
-- Expect: 6 | skfs | 4 | ongc
