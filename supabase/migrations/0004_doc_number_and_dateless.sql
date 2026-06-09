-- =====================================================================
-- ONGC Rotation System — document number + date-less documents
--
-- Some documents are identity numbers with no meaningful issue/expiry date
-- (Aadhaar, PAN). For those we hide the date fields and capture an optional
-- document number instead.
--
--   * employee_documents.document_number  — optional, any document
--   * document_types.tracks_dates         — false => no issue/expiry fields,
--                                            show the number field instead
--
-- Run AFTER seed.sql so the Aadhaar/PAN rows exist to be updated.
-- Safe to run more than once.
-- =====================================================================

alter table employee_documents
  add column if not exists document_number text;

alter table document_types
  add column if not exists tracks_dates boolean not null default true;

-- Aadhaar and PAN are date-less identity documents.
update document_types
  set tracks_dates = false
  where name in ('Aadhaar Card', 'PAN Card');
