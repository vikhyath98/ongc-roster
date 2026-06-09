-- =====================================================================
-- ONGC Rotation System — seed data  (SPEC.md §4 "Seed data to load")
-- Safe to run more than once: every insert is idempotent (ON CONFLICT).
-- Run AFTER 0001_init.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categories (the 4 broad buckets — SPEC.md §3.7)
-- ---------------------------------------------------------------------
insert into categories (name) values
  ('Unskilled'),
  ('Semi-skilled'),
  ('Skilled'),
  ('Outsourced')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Designations
-- The six below are required so the document mapping can attach (SPEC.md §4).
-- NOTE: the category assignment for each is a sensible default and is fully
-- editable in Configuration — adjust if your real grading differs.
-- ---------------------------------------------------------------------
insert into designations (name, category_id)
select d.name, c.id
from (values
  ('Catering Manager', 'Skilled'),
  ('Cook',             'Semi-skilled'),
  ('Asst Cook',        'Semi-skilled'),
  ('Electrician',      'Skilled'),
  ('Plumber',          'Skilled'),
  ('Housekeeper',      'Unskilled')
) as d(name, category)
join categories c on c.name = d.category
on conflict (name, category_id) do nothing;

-- >>> PLACEHOLDER: add your remaining real designations here. <<<
-- Uncomment and fill in. Use one of: Unskilled, Semi-skilled, Skilled, Outsourced.
-- (You can also add these from the Configuration screen once the app is running.)
--
-- insert into designations (name, category_id)
-- select d.name, c.id
-- from (values
--   ('Steward',         'Unskilled'),
--   ('Pest Controller', 'Outsourced'),
--   ('__YOUR_DESIGNATION__', '__CATEGORY__')
-- ) as d(name, category)
-- join categories c on c.name = d.category
-- on conflict (name, category_id) do nothing;

-- ---------------------------------------------------------------------
-- Installations — 8 platforms + 6 rigs (real names, all active for now).
-- is_active is toggleable from Configuration to deactivate without deleting.
-- ---------------------------------------------------------------------
insert into installations (name, type, is_active) values
  ('ICP',          'platform', true),
  ('SHP',          'platform', true),
  ('SAGAR SAMRAT', 'platform', true),
  ('WIN',          'platform', true),
  ('NEELAM',       'platform', true),
  ('BLQ-I',        'platform', true),
  ('TCPP',         'platform', true),
  ('R-12',         'platform', true),
  ('SAGAR JYOTI',  'rig',      true),
  ('SAGAR GAURAV', 'rig',      true),
  ('SAGAR SHAKTI', 'rig',      true),
  ('SAGAR UDAY',   'rig',      true),
  ('SAGAR RATNA',  'rig',      true),
  ('SAGAR KIRAN',  'rig',      true)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Document types (SPEC.md §4 "Document types seed")
-- Universal docs (applies_to_all = true) are required of every employee.
-- Only Medical Fitness gets a default_validity_days (365); the rest that
-- expire in reality use a manager-set expiry per employee (null here).
-- ---------------------------------------------------------------------
insert into document_types (name, is_required, applies_to_all, default_validity_days) values
  ('PCC (Police Clearance Certificate)',                                 true, true,  null),
  ('Aadhaar Card',                                                       true, true,  null),
  ('PAN Card',                                                           true, true,  null),
  ('Passport',                                                           true, true,  null),
  ('STCW/BST',                                                           true, true,  null),
  ('HUET',                                                               true, true,  null),
  ('Medical Fitness Certificate',                                        true, true,  365),
  ('HACCP',                                                              true, false, null),
  ('Hotel Management (2 yrs exp) OR 5-yr Offshore Experience Letter',    true, false, null),
  ('Cookery Certificate',                                                true, false, null),
  ('PWD Licence',                                                        true, false, null),
  ('ITI Certificate',                                                    true, false, null),
  ('1-yr Experience Letter',                                             true, false, null)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Document -> designation mappings (the many-to-many; SPEC.md §4 notes).
-- ITI Certificate intentionally maps to BOTH Electrician and Plumber.
-- The "OR" document is a single document_type mapped to Catering Manager + Cook.
-- ---------------------------------------------------------------------
insert into document_type_designations (document_type_id, designation_id)
select dt.id, dg.id
from (values
  ('HACCP',                                                           'Catering Manager'),
  ('Hotel Management (2 yrs exp) OR 5-yr Offshore Experience Letter', 'Catering Manager'),
  ('Hotel Management (2 yrs exp) OR 5-yr Offshore Experience Letter', 'Cook'),
  ('Cookery Certificate',                                             'Asst Cook'),
  ('PWD Licence',                                                     'Electrician'),
  ('ITI Certificate',                                                 'Electrician'),
  ('ITI Certificate',                                                 'Plumber'),
  ('1-yr Experience Letter',                                          'Housekeeper')
) as m(doc, designation)
join document_types dt on dt.name = m.doc
join designations  dg on dg.name = m.designation
on conflict do nothing;

-- ---------------------------------------------------------------------
-- App config defaults (all editable in the app — SPEC.md §4 table)
-- ---------------------------------------------------------------------
insert into app_config (key, value) values
  ('min_service_days',           '56'),    -- eligible to rotate off
  ('warning_day',                '65'),    -- warning state
  ('max_service_days',           '70'),    -- hard threshold
  ('penalty_rate',               '1000'),  -- INR per person per day
  ('confirmation_validity_days', '14')     -- how long a confirmation stays valid
on conflict (key) do nothing;
