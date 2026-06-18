-- =====================================================================
-- ONGC Rotation System — add 'cancelled' to replacement_pairings.status
--
-- A manager can cancel a still-'pending' pairing (a line item that was never
-- pulled onto an RFM). The row is kept for audit; only the status changes.
--
-- Safe to run more than once.
-- =====================================================================

alter table replacement_pairings drop constraint if exists replacement_pairings_status_check;
alter table replacement_pairings add constraint replacement_pairings_status_check
  check (status in ('pending','rfm_listed','boarded','dropped','no_show','cancelled'));
