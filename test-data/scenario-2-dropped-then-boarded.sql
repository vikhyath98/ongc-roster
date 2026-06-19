-- =====================================================================
-- SCENARIO 2 — Relief DROPPED, then retried and boarded  (SPEC.md §14.6)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   An offshore employee over day 70 (80 days served) whose relief was:
--     Attempt 1 — manifest request filed, RFM line outcome 'dropped',
--                 pairing status 'dropped'.
--     Attempt 2 — a NEW pairing (retry_of = attempt 1), RFM line outcome
--                 'boarded', pairing status 'boarded', consumed_at NULL,
--                 relief arrived (RFM sortie) AFTER the day-70 threshold.
--   Walking the retry chain back finds a prior 'dropped' attempt.
--
-- WHAT TO DO IN THE APP:
--   1. Board → Offboard tab.
--   2. Find "TEST-SCENARIO-2 Employee (overstay)" (Cook, 📍 ICP, ~80d served).
--   3. Select, leave sign-off date as today, click Offboard.
--   4. The "Overstay attribution" modal opens.
--
-- EXPECTED MODAL OUTPUT:
--   * Segment 1 — wait for relief: 6d, default = ONGC
--       (most recent prior attempt in the chain was DROPPED → ONGC's fault)
--   * Segment 2 — after relief arrived: 4d, default = ONGC
--       (relief already arrived; further delay is a return-transport problem)
--
-- HOW TO CONFIRM IT PASSED:
--   * Modal shows Seg 1 = 6d / ONGC and Seg 2 = 4d / ONGC by default.
--   * Confirm sign-off; modal closes, offboard completes.
--   * Run the VERIFY query: segment_1_days=6, segment_1_attribution='ongc',
--     segment_2_days=4, segment_2_attribution='ongc'.
--
-- Day math (vs today): sign_on = today−79 ⇒ 80d served; day-70 threshold =
-- today−10; relief boarded (RFM sortie) = today−4. Seg1 = (−4)−(−10) = 6d;
-- Seg2 = today−(today−4) = 4d.
-- Independently runnable; cleans up its own TEST-S2-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (FK-safe order) -------------------------
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-S2-%')
     or employee_id in (select id from employees where emp_id like 'TEST-S2-%');
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S2-%'));
delete from understay_records
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S2-%'));
delete from penalty_log
  where employee_id in (select id from employees where emp_id like 'TEST-S2-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-S2-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-S2-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-S2-%');
delete from manifest_requests where notes like 'TEST-S2-%';
delete from rfms where rfm_number like 'TEST-S2-%';
delete from employees where emp_id like 'TEST-S2-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out     uuid;   -- outgoing (the overstayer being offboarded)
  v_in      uuid;   -- incoming (relief)
  v_req1    uuid;   v_item1 uuid;  v_rfm1 uuid;  v_line1 uuid;  v_pair1 uuid;
  v_req2    uuid;   v_item2 uuid;  v_rfm2 uuid;  v_line2 uuid;
  v_rot_in  uuid;
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  -- People
  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S2-OUT', 'TEST-SCENARIO-2 Employee (overstay)', v_desig, v_install, 'active')
  returning id into v_out;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S2-IN', 'TEST-SCENARIO-2 Relief', v_desig, v_install, 'active')
  returning id into v_in;

  -- Outgoing employee's open overstay stint (80 days served).
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 79, (current_date - 79) + 70);

  -- Relief's open stint, signed on the boarded RFM's sortie date (today−4).
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_in, v_install, current_date - 4, (current_date - 4) + 70)
  returning id into v_rot_in;

  -- ---- Attempt 1: requested, RFM-listed, DROPPED --------------------
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 12, 'sent', 'TEST-S2-attempt1 (dropped)')
  returning id into v_req1;

  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req1, v_in, v_out)
  returning id into v_item1;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-S2-RFM1', v_req1, v_install, current_date - 8)
  returning id into v_rfm1;

  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfm1, v_in, 'dropped', now())
  returning id into v_line1;

  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id,
     rfm_line_item_id, status)
  values (v_item1, v_out, v_in, v_line1, 'dropped')
  returning id into v_pair1;

  -- ---- Attempt 2: retry, RFM-listed, BOARDED (active pairing) -------
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 6, 'approved', 'TEST-S2-attempt2 (boarded)')
  returning id into v_req2;

  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req2, v_in, v_out)
  returning id into v_item2;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-S2-RFM2', v_req2, v_install, current_date - 4)
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
-- where e.emp_id = 'TEST-S2-OUT';
-- Expect: 6 | ongc | 4 | ongc
