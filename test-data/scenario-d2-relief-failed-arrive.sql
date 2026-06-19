-- =====================================================================
-- SCENARIO D2 — Dashboard Alert 2 "Relief failed to arrive"  (SPEC.md §14.7)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   One offshore outgoing employee, 75 days served (past the day-70 threshold),
--   whose only relief attempt was dropped and never re-boarded — so the manager
--   can see WHY this overdue case is stuck.
--     TEST-D2-OUT  offshore Cook @ ICP, sign_on = today-74 (75 days served)
--     TEST-D2-IN   relief on base; their RFM line outcome = 'dropped'
--   One pairing (status 'dropped'); NO boarded successor pairing for OUT.
--
-- WHAT TO DO IN THE APP:
--   1. Open the Dashboard (Home).
--   2. Find the "🚁 Relief failed to arrive" card.
--
-- EXPECTED:
--   * One row: TEST-D2 Outgoing, Cook · 📍 ICP, 75d, "Over threshold" pill, and
--     the reason line "Last relief was dropped by ONGC — no seat".
--
-- HOW TO CONFIRM IT PASSED:
--   * The row appears with the dropped reason.
--   * Run the VERIFY query: days_served = 75, pairing_status = 'dropped',
--     has_boarded_successor = false.
--
-- Day math: sign_on = today-74 ⇒ 75 days served (> max 70).
-- Independently runnable; cleans up its own TEST-D2-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (correct FK dependency order) -----------
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D2-%'));
delete from understay_records
  where employee_id in (select id from employees where emp_id like 'TEST-D2-%');
update rfm_line_items set rotation_log_id = null
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D2-%'));
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-D2-%')
     or employee_id in (select id from employees where emp_id like 'TEST-D2-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-D2-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-D2-%');
delete from rfms where rfm_number like 'TEST-D2-%';
delete from manifest_request_items
  where employee_id in (select id from employees where emp_id like 'TEST-D2-%')
     or replacing_employee_id in (select id from employees where emp_id like 'TEST-D2-%')
     or manifest_request_id in (select id from manifest_requests where notes like 'TEST-D2-%');
delete from manifest_requests where notes like 'TEST-D2-%';
delete from availability
  where employee_id in (select id from employees where emp_id like 'TEST-D2-%');
delete from call_log
  where employee_id in (select id from employees where emp_id like 'TEST-D2-%');
delete from employee_documents
  where employee_id in (select id from employees where emp_id like 'TEST-D2-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-D2-%');
delete from employees where emp_id like 'TEST-D2-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out uuid; v_in uuid;
  v_req uuid; v_item uuid; v_rfm uuid; v_line uuid;
  ts5 timestamptz := ((current_date - 5)::date + time '09:00:00') at time zone 'Asia/Kolkata';
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-D2-OUT', 'TEST-D2 Outgoing (overdue)', v_desig, v_install, 'active')
  returning id into v_out;
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 74, (current_date - 74) + 70);

  insert into employees (emp_id, full_name, designation_id, employment_status)
  values ('TEST-D2-IN', 'TEST-D2 Relief (dropped)', v_desig, 'active')
  returning id into v_in;

  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 7, 'sent', 'TEST-D2 relief-failed fixture')
  returning id into v_req;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in, v_out) returning id into v_item;

  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-D2-RFM-01', v_req, v_install, current_date - 5) returning id into v_rfm;
  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfm, v_in, 'dropped', ts5) returning id into v_line;

  -- Dropped pairing, no boarded successor → "relief failed to arrive".
  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id, rfm_line_item_id, status)
  values (v_item, v_out, v_in, v_line, 'dropped');
end $$;

-- ---- VERIFY --------------------------------------------------------
-- select e.emp_id,
--        (current_date - rl.sign_on_date) + 1            as days_served,
--        p.status                                        as pairing_status,
--        exists (
--          select 1 from replacement_pairings bp
--          where bp.outgoing_employee_id = e.id
--            and bp.status = 'boarded' and bp.consumed_at is null
--        )                                               as has_boarded_successor
-- from employees e
-- join rotation_log rl on rl.employee_id = e.id and rl.sign_off_date is null
-- left join replacement_pairings p on p.outgoing_employee_id = e.id
-- where e.emp_id = 'TEST-D2-OUT';
-- Expect: 75 | dropped | false
