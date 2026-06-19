-- =====================================================================
-- SCENARIO D3 — CONTROL: pending pairing, no alert  (SPEC.md §14.7)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   One offshore employee past the warning day (67 days served) whose relief is
--   already in motion as a 'pending' pairing (requested, no RFM logged yet).
--     TEST-D3-OUT  offshore Cook @ ICP, sign_on = today-66 (67 days served)
--     TEST-D3-IN   relief on base
--   manifest_request + item naming both; one replacement_pairings row 'pending'.
--
-- WHY IT'S A CONTROL (should appear in NEITHER alert):
--   * Alert 2 "Relief failed to arrive": needs days > max (70) AND a failed
--     (dropped/no_show) latest pairing. OUT is at 67d and the pairing is
--     'pending' → excluded on both counts.
--   * Alert 3 "Manifest needed soon": past warning_day, but OUT IS already named
--     in a manifest_request_item (replacing_employee_id) → excluded.
--
-- WHAT TO DO IN THE APP:
--   1. Open the Dashboard (Home).
--   2. Confirm TEST-D3 Outgoing does NOT appear in "Relief failed to arrive"
--      or "Manifest needed soon". (They will show in the normal "Needs
--      attention" / rotation-window sections — that's expected, not an alert.)
--
-- HOW TO CONFIRM IT PASSED:
--   * Neither manifestation alert lists TEST-D3-OUT.
--   * Run the VERIFY query: pending_pairings = 1, failed_pairings = 0.
--
-- Day math: sign_on = today-66 ⇒ 67 days served (warning 65 ≤ 67 < max 70).
-- Independently runnable; cleans up its own TEST-D3-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (correct FK dependency order) -----------
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D3-%'));
delete from understay_records
  where employee_id in (select id from employees where emp_id like 'TEST-D3-%');
update rfm_line_items set rotation_log_id = null
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D3-%'));
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-D3-%')
     or employee_id in (select id from employees where emp_id like 'TEST-D3-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-D3-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-D3-%');
delete from rfms where rfm_number like 'TEST-D3-%';
delete from manifest_request_items
  where employee_id in (select id from employees where emp_id like 'TEST-D3-%')
     or replacing_employee_id in (select id from employees where emp_id like 'TEST-D3-%')
     or manifest_request_id in (select id from manifest_requests where notes like 'TEST-D3-%');
delete from manifest_requests where notes like 'TEST-D3-%';
delete from availability
  where employee_id in (select id from employees where emp_id like 'TEST-D3-%');
delete from call_log
  where employee_id in (select id from employees where emp_id like 'TEST-D3-%');
delete from employee_documents
  where employee_id in (select id from employees where emp_id like 'TEST-D3-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-D3-%');
delete from employees where emp_id like 'TEST-D3-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out uuid; v_in uuid; v_req uuid; v_item uuid;
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-D3-OUT', 'TEST-D3 Outgoing (pending relief)', v_desig, v_install, 'active')
  returning id into v_out;
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 66, (current_date - 66) + 70);

  insert into employees (emp_id, full_name, designation_id, employment_status)
  values ('TEST-D3-IN', 'TEST-D3 Relief (pending)', v_desig, 'active')
  returning id into v_in;

  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 2, 'sent', 'TEST-D3 pending-pairing control')
  returning id into v_req;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in, v_out) returning id into v_item;

  -- Pending pairing: requested, no RFM logged yet (no rfm_line_item_id).
  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id, status)
  values (v_item, v_out, v_in, 'pending');
end $$;

-- ---- VERIFY --------------------------------------------------------
-- select e.emp_id,
--        count(*) filter (where p.status = 'pending')              as pending_pairings,
--        count(*) filter (where p.status in ('dropped','no_show')) as failed_pairings
-- from employees e
-- left join replacement_pairings p on p.outgoing_employee_id = e.id
-- where e.emp_id = 'TEST-D3-OUT'
-- group by e.emp_id;
-- Expect: pending_pairings = 1, failed_pairings = 0
