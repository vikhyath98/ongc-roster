-- =====================================================================
-- SCENARIO 4 — Manifested in time, relief arrived BEFORE day 70 (SPEC §14.6)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   An offshore employee over day 70 (80 days served). The manifest request
--   was filed while they were on day 63 (inside the safe 56–65 window), and
--   the relief actually BOARDED on day 66 — i.e. the relief RFM sortie_date is
--   BEFORE the day-70 hard threshold. Relief arrived in good time; the person
--   is still offshore only because of a return-transport delay afterwards.
--   First-try success (no prior failed attempt).
--
-- WHAT TO DO IN THE APP:
--   1. Board → Offboard tab.
--   2. Find "TEST-SCENARIO-4 Employee (overstay)" (Cook, 📍 ICP, ~80d served).
--   3. Select, leave sign-off date as today, click Offboard.
--   4. The "Overstay attribution" modal opens.
--
-- EXPECTED MODAL OUTPUT:
--   * Segment 1 — wait for relief: 0d
--       (relief arrived BEFORE the threshold → nothing to attribute here.
--        Its default attribution is immaterial at 0 days.)
--   * Segment 2 — after relief arrived: 10d, default = ONGC
--       (the entire overstay sits after relief arrival → return-transport
--        problem → ONGC by default)
--
-- HOW TO CONFIRM IT PASSED:
--   * Modal shows Seg 1 = 0d and Seg 2 = 10d / ONGC.
--   * Confirm sign-off; run the VERIFY query: segment_1_days=0,
--     segment_2_days=10, segment_2_attribution='ongc'.
--
-- Day math (vs today): sign_on = today−79 ⇒ 80d served; day-70 threshold =
-- today−10; request filed = today−17 (= day 63, in window); relief boarded
-- (RFM sortie) = today−14 (= day 66, before threshold).
--   Seg1 = max(0, (−14)−(−10)) = max(0,−4) = 0;
--   Seg2 = today − max(relief, threshold) = today − (today−10) = 10.
-- Independently runnable; cleans up its own TEST-S4-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (FK-safe order) -------------------------
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-S4-%')
     or employee_id in (select id from employees where emp_id like 'TEST-S4-%');
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S4-%'));
delete from understay_records
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-S4-%'));
delete from penalty_log
  where employee_id in (select id from employees where emp_id like 'TEST-S4-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-S4-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-S4-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-S4-%');
delete from manifest_requests where notes like 'TEST-S4-%';
delete from rfms where rfm_number like 'TEST-S4-%';
delete from employees where emp_id like 'TEST-S4-%';

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
  values ('TEST-S4-OUT', 'TEST-SCENARIO-4 Employee (overstay)', v_desig, v_install, 'active')
  returning id into v_out;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-S4-IN', 'TEST-SCENARIO-4 Relief', v_desig, v_install, 'active')
  returning id into v_in;

  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 79, (current_date - 79) + 70);

  -- Relief signed on at the RFM sortie (today−14 = outgoing's day 66).
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_in, v_install, current_date - 14, (current_date - 14) + 70)
  returning id into v_rot_in;

  -- Filed in the safe window (day 63), first try, boarded.
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 17, 'approved', 'TEST-S4 (in-window, boarded early)')
  returning id into v_req;

  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in, v_out)
  returning id into v_item;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-S4-RFM', v_req, v_install, current_date - 14)
  returning id into v_rfm;

  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at, rotation_log_id)
  values (v_rfm, v_in, 'boarded', now(), v_rot_in)
  returning id into v_line;

  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id,
     rfm_line_item_id, status, relief_deadline)
  values (v_item, v_out, v_in, v_line, 'boarded', (current_date - 14) + 1);
end $$;

-- ---- VERIFY (run AFTER offboarding in the app) ---------------------
-- select oa.segment_1_days, oa.segment_1_attribution,
--        oa.segment_2_days, oa.segment_2_attribution
-- from overstay_attributions oa
-- join rotation_log rl on rl.id = oa.rotation_log_id
-- join employees e on e.id = rl.employee_id
-- where e.emp_id = 'TEST-S4-OUT';
-- Expect: 0 | (ongc, immaterial at 0d) | 10 | ongc
