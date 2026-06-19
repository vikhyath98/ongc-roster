-- =====================================================================
-- SCENARIO D4 — NEGATIVE CONTROL: dropped then re-boarded  (SPEC.md §14.7)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   A relief employee who was dropped on the first attempt but successfully
--   boarded on a retry — so their MOST RECENT RFM outcome is 'boarded' and they
--   are now offshore. They must NOT appear in Alert 1 "Awaiting re-manifest".
--     TEST-D4-OUT  offshore Cook @ ICP (the employee being relieved)
--     TEST-D4-IN   relief: attempt 1 dropped (today-10), attempt 2 boarded
--                  (today-3) → now offshore @ ICP
--   Two RFM line items + two pairings chained via retry_of_pairing_id.
--
-- WHAT TO DO IN THE APP:
--   1. Open the Dashboard (Home).
--   2. Confirm "⏳ Awaiting re-manifest" does NOT list any TEST-D4 person.
--
-- EXPECTED:
--   * TEST-D4-IN does not appear in Awaiting re-manifest (latest outcome is
--     boarded, and they are offshore). The dropped first attempt is history,
--     not the current state.
--
-- HOW TO CONFIRM IT PASSED:
--   * No TEST-D4 row in the Awaiting re-manifest card.
--   * Run the VERIFY query: TEST-D4-IN has current_installation_id NOT NULL and
--     their most-recent rfm_line_item outcome is 'boarded' (not dropped/no_show).
--
-- Independently runnable; cleans up its own TEST-D4-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (correct FK dependency order) -----------
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D4-%'));
delete from understay_records
  where employee_id in (select id from employees where emp_id like 'TEST-D4-%');
update rfm_line_items set rotation_log_id = null
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D4-%'));
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-D4-%')
     or employee_id in (select id from employees where emp_id like 'TEST-D4-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-D4-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-D4-%');
delete from rfms where rfm_number like 'TEST-D4-%';
delete from manifest_request_items
  where employee_id in (select id from employees where emp_id like 'TEST-D4-%')
     or replacing_employee_id in (select id from employees where emp_id like 'TEST-D4-%')
     or manifest_request_id in (select id from manifest_requests where notes like 'TEST-D4-%');
delete from manifest_requests where notes like 'TEST-D4-%';
delete from availability
  where employee_id in (select id from employees where emp_id like 'TEST-D4-%');
delete from call_log
  where employee_id in (select id from employees where emp_id like 'TEST-D4-%');
delete from employee_documents
  where employee_id in (select id from employees where emp_id like 'TEST-D4-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-D4-%');
delete from employees where emp_id like 'TEST-D4-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out uuid; v_in uuid;
  v_req uuid; v_it1 uuid; v_it2 uuid;
  v_rfm1 uuid; v_rfm2 uuid; v_l1 uuid; v_l2 uuid;
  v_rot_in uuid; v_pair1 uuid;
  ts10 timestamptz := ((current_date - 10)::date + time '09:00:00') at time zone 'Asia/Kolkata';
  ts3  timestamptz := ((current_date - 3)::date  + time '09:00:00') at time zone 'Asia/Kolkata';
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  -- Outgoing offshore employee being relieved.
  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-D4-OUT', 'TEST-D4 Outgoing', v_desig, v_install, 'active')
  returning id into v_out;
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 74, (current_date - 74) + 70);

  -- Relief: now offshore (boarded on attempt 2), with an open stint.
  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-D4-IN', 'TEST-D4 Relief (re-boarded)', v_desig, v_install, 'active')
  returning id into v_in;
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_in, v_install, current_date - 3, (current_date - 3) + 70)
  returning id into v_rot_in;

  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 12, 'approved', 'TEST-D4 resolved (dropped then boarded)')
  returning id into v_req;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in, v_out) returning id into v_it1;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in, v_out) returning id into v_it2;

  -- Attempt 1: dropped.
  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-D4-RFM-01', v_req, v_install, current_date - 10) returning id into v_rfm1;
  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfm1, v_in, 'dropped', ts10) returning id into v_l1;
  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id, rfm_line_item_id, status)
  values (v_it1, v_out, v_in, v_l1, 'dropped') returning id into v_pair1;

  -- Attempt 2: boarded (retry of attempt 1), relief now offshore.
  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-D4-RFM-02', v_req, v_install, current_date - 3) returning id into v_rfm2;
  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at, rotation_log_id)
  values (v_rfm2, v_in, 'boarded', ts3, v_rot_in) returning id into v_l2;
  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id,
     retry_of_pairing_id, rfm_line_item_id, status, relief_deadline)
  values (v_it2, v_out, v_in, v_pair1, v_l2, 'boarded', (current_date - 3) + 1);
end $$;

-- ---- VERIFY --------------------------------------------------------
-- Most-recent outcome per TEST-D4 relief employee + their location.
-- select distinct on (e.id)
--        e.emp_id, e.current_installation_id, li.outcome, li.outcome_recorded_at
-- from employees e
-- join rfm_line_items li on li.employee_id = e.id
-- where e.emp_id like 'TEST-D4-%'
-- order by e.id, li.outcome_recorded_at desc;
-- Expect: TEST-D4-IN | <installation id, NOT NULL> | boarded | today-3
--         (most-recent outcome is 'boarded', not dropped/no_show)
