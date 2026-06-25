-- =====================================================================
-- 0013_file_paths.sql — storage paths for photos + document scans
-- (SPEC.md §17.P, Workstream P)
--
-- Files live in the Supabase Storage bucket 'employee-documents'; these columns
-- hold the object PATH only (never a public URL — the app serves files via
-- short-lived signed URLs). Both nullable, no constraints. Idempotent.
-- =====================================================================

alter table employees
  add column if not exists photo_path text;

alter table employee_documents
  add column if not exists file_path text;
