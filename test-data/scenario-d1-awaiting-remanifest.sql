-- =====================================================================
-- SCENARIO D1 — Dashboard Alert 1 "Awaiting re-manifest"  (SPEC.md §14.7)
-- =====================================================================
--
-- WHAT THIS SEEDS:
--   One in-service offshore outgoing employee (the person being relieved) and
--   four base-side relief employees whose most recent RFM outcome failed and
--   who are still on base awaiting a re-manifest:
--     Dropped sub-group (chase ONGC for a seat):
--       TEST-D1-IN-DROP-1  dropped 1 day ago  -> badge NEUTRAL (0-2)
--       TEST-D1-IN-DROP-4  dropped 4 days ago -> badge AMBER   (3-5)
--       TEST-D1-IN-DROP-7  dropped 7 days ago -> badge RED     (6+)
--     No-show sub-group (chase the employee / reliability):
--       TEST-D1-IN-NOSHOW  no-show 4 days ago -> badge AMBER, confirmed=false,
--                          no_show_count=1 (as the app sets on a no-show)
--
-- WHAT TO DO IN THE APP:
--   1. Open the Dashboard (Home).
--   2. Find the "⏳ Awaiting re-manifest" card.
--
-- EXPECTED:
--   * Count "4 on base".
--   * "Dropped — chase ONGC for a seat" sub-group: three rows with day-waiting
--     badges 1d (neutral/grey), 4d (amber), 7d (red), sorted most-waiting first.
--   * "No-show — chase the employee / reconsider reliability" sub-group: one row,
--     4d (amber).
--   * Each row has "New request" and "Mark as left" actions.
--
-- HOW TO CONFIRM IT PASSED:
--   * The four people appear in the right sub-groups with the badge colours above.
--   * Run the VERIFY query: four rfm_line_items, three 'dropped' + one 'no_show',
--     with outcome_recorded_at on today-1 / today-4 / today-7 / today-4.
--
-- ALSO FIX (flag for reviewer — DO NOT fix yet):
--   alerts.js Alert 1 derives the wait date as `line.stamp.slice(0, 10)` where
--   `stamp = outcome_recorded_at` — i.e. it slices the RAW timestamptz, which
--   Supabase returns in UTC. So a drop recorded late at night IST (after 18:30,
--   = next day UTC) or early morning (before 05:30, = prev day UTC) reads one
--   calendar day off — the same IST/UTC slicing class of bug fixed in addDays
--   (eb17e66). It is not literally passed whole to daysInclusive (it is sliced,
--   then daysBetween is used), but the slice should be IST-converted first.
--   These scripts seed outcome_recorded_at at 09:00 IST precisely to sidestep
--   it, so the badges read correctly for the test. Reviewer to confirm before
--   any fix.
--
-- Independently runnable; cleans up its own TEST-D1-% rows first.
-- =====================================================================

-- ---- cleanup any prior run (correct FK dependency order) -----------
delete from overstay_attributions
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D1-%'));
delete from understay_records
  where employee_id in (select id from employees where emp_id like 'TEST-D1-%');
update rfm_line_items set rotation_log_id = null
  where rotation_log_id in (select id from rotation_log where employee_id in
        (select id from employees where emp_id like 'TEST-D1-%'));
delete from rfm_line_items
  where rfm_id in (select id from rfms where rfm_number like 'TEST-D1-%')
     or employee_id in (select id from employees where emp_id like 'TEST-D1-%');
delete from replacement_pairings
  where outgoing_employee_id in (select id from employees where emp_id like 'TEST-D1-%')
     or incoming_employee_id in (select id from employees where emp_id like 'TEST-D1-%');
delete from rfms where rfm_number like 'TEST-D1-%';
delete from manifest_request_items
  where employee_id in (select id from employees where emp_id like 'TEST-D1-%')
     or replacing_employee_id in (select id from employees where emp_id like 'TEST-D1-%')
     or manifest_request_id in (select id from manifest_requests where notes like 'TEST-D1-%');
delete from manifest_requests where notes like 'TEST-D1-%';
delete from availability
  where employee_id in (select id from employees where emp_id like 'TEST-D1-%');
delete from call_log
  where employee_id in (select id from employees where emp_id like 'TEST-D1-%');
delete from employee_documents
  where employee_id in (select id from employees where emp_id like 'TEST-D1-%');
delete from rotation_log
  where employee_id in (select id from employees where emp_id like 'TEST-D1-%');
delete from employees where emp_id like 'TEST-D1-%';

-- ---- fresh seed ----------------------------------------------------
do $$
declare
  v_install uuid;
  v_desig   uuid;
  v_out     uuid;
  v_in1 uuid; v_in4 uuid; v_in7 uuid; v_inns uuid;
  v_req uuid;
  v_it1 uuid; v_it4 uuid; v_it7 uuid; v_itns uuid;
  v_rfmd uuid; v_rfmn uuid;
  v_ld1 uuid; v_ld4 uuid; v_ld7 uuid; v_lns uuid;
  -- IST-aware outcome timestamps (09:00 IST) so the UTC date-slice in alerts.js
  -- lands on the intended calendar day.
  ts1 timestamptz := ((current_date - 1)::date + time '09:00:00') at time zone 'Asia/Kolkata';
  ts4 timestamptz := ((current_date - 4)::date + time '09:00:00') at time zone 'Asia/Kolkata';
  ts7 timestamptz := ((current_date - 7)::date + time '09:00:00') at time zone 'Asia/Kolkata';
begin
  select id into v_install from installations where name = 'ICP';
  select id into v_desig   from designations  where name = 'Cook';
  if v_install is null or v_desig is null then
    raise exception 'Seed data missing (ICP / Cook). Run seed.sql first.';
  end if;

  -- Offshore outgoing employee (in service, day ~30) — the one being relieved.
  insert into employees (emp_id, full_name, designation_id, current_installation_id, employment_status)
  values ('TEST-D1-OUT', 'TEST-D1 Outgoing (in service)', v_desig, v_install, 'active')
  returning id into v_out;
  insert into rotation_log (employee_id, installation_id, sign_on_date, expected_rotation_date)
  values (v_out, v_install, current_date - 30, (current_date - 30) + 70);

  -- Four base-side relief employees (on base: current_installation_id = null).
  insert into employees (emp_id, full_name, designation_id, employment_status)
  values ('TEST-D1-IN-DROP-1', 'TEST-D1 Relief Dropped 1d', v_desig, 'active') returning id into v_in1;
  insert into employees (emp_id, full_name, designation_id, employment_status)
  values ('TEST-D1-IN-DROP-4', 'TEST-D1 Relief Dropped 4d', v_desig, 'active') returning id into v_in4;
  insert into employees (emp_id, full_name, designation_id, employment_status)
  values ('TEST-D1-IN-DROP-7', 'TEST-D1 Relief Dropped 7d', v_desig, 'active') returning id into v_in7;
  insert into employees (emp_id, full_name, designation_id, employment_status, no_show_count)
  values ('TEST-D1-IN-NOSHOW', 'TEST-D1 Relief No-show 4d', v_desig, 'active', 1) returning id into v_inns;

  -- No-show flips the employee's confirmation to false (matches the app).
  insert into availability (employee_id, confirmed) values (v_inns, false);

  -- One request; an item per relief naming the outgoing employee as replaced.
  insert into manifest_requests (installation_id, request_date, status, notes)
  values (v_install, current_date - 8, 'sent', 'TEST-D1 awaiting-remanifest fixture')
  returning id into v_req;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in1, v_out) returning id into v_it1;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in4, v_out) returning id into v_it4;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_in7, v_out) returning id into v_it7;
  insert into manifest_request_items (manifest_request_id, employee_id, replacing_employee_id)
  values (v_req, v_inns, v_out) returning id into v_itns;

  -- Dropped RFM (3 line items) + No-show RFM (1 line item).
  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-D1-RFM-DROP', v_req, v_install, current_date - 7) returning id into v_rfmd;
  insert into rfms (rfm_number, manifest_request_id, installation_id, sortie_date)
  values ('TEST-D1-RFM-NOSHOW', v_req, v_install, current_date - 4) returning id into v_rfmn;

  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfmd, v_in1, 'dropped', ts1) returning id into v_ld1;
  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfmd, v_in4, 'dropped', ts4) returning id into v_ld4;
  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfmd, v_in7, 'dropped', ts7) returning id into v_ld7;
  insert into rfm_line_items (rfm_id, employee_id, outcome, outcome_recorded_at)
  values (v_rfmn, v_inns, 'no_show', ts4) returning id into v_lns;

  -- One pairing per line item; status mirrors the outcome.
  insert into replacement_pairings
    (manifest_request_item_id, outgoing_employee_id, incoming_employee_id, rfm_line_item_id, status)
  values
    (v_it1,  v_out, v_in1,  v_ld1, 'dropped'),
    (v_it4,  v_out, v_in4,  v_ld4, 'dropped'),
    (v_it7,  v_out, v_in7,  v_ld7, 'dropped'),
    (v_itns, v_out, v_inns, v_lns, 'no_show');
end $$;

-- ---- VERIFY --------------------------------------------------------
-- select e.emp_id, li.outcome, li.outcome_recorded_at
-- from rfm_line_items li
-- join employees e on e.id = li.employee_id
-- where e.emp_id like 'TEST-D1-%'
-- order by li.outcome_recorded_at;
-- Expect: DROP-7 dropped (today-7), DROP-4 dropped (today-4),
--         NOSHOW no_show (today-4), DROP-1 dropped (today-1).
