import { supabase } from './supabase'

// Penalty tracker data (SPEC.md §5.7, §6.7).
// Live exposure comes from the penalty_exposure view (no writes on read).
// Reconciliation is persisted in penalty_log; a stint is "reconciled" when a
// penalty_log row with status='reconciled' exists for it.

export async function listPenaltyExposure() {
  return supabase
    .from('penalty_exposure')
    .select('*')
    .order('total_penalty', { ascending: false })
}

export async function listReconciledPenalties() {
  return supabase
    .from('penalty_log')
    .select(
      'id,rotation_log_id,days_over,daily_penalty_rate,total_penalty,reconciled_at,reconciliation_remark,' +
        'employee:employees(emp_id,full_name,designation:designations(name)),' +
        'installation:installations(name)'
    )
    .eq('status', 'reconciled')
    .order('reconciled_at', { ascending: false })
}

// Reconcile a live exposure row by snapshotting its current figures into
// penalty_log with a mandatory remark (SPEC.md §3.2, §6.7). The DB also
// enforces the non-empty remark and one-row-per-stint (unique rotation_log_id).
export async function reconcilePenalty(exposureRow, remark, userId) {
  const r = remark?.trim()
  if (!r) return { error: { message: 'A reconciliation remark is required.' } }

  const { data, error } = await supabase
    .from('penalty_log')
    .insert({
      employee_id: exposureRow.employee_id,
      installation_id: exposureRow.installation_id,
      rotation_log_id: exposureRow.rotation_log_id,
      days_over: exposureRow.days_over,
      daily_penalty_rate: exposureRow.daily_penalty_rate,
      total_penalty: exposureRow.total_penalty,
      status: 'reconciled',
      reconciled_by: userId ?? null,
      reconciled_at: new Date().toISOString(),
      reconciliation_remark: r,
    })
    .select()
    .single()

  if (error && error.code === '23505') {
    return { error: { ...error, message: 'This penalty was already reconciled. Refresh to see it.' } }
  }
  return { data, error }
}
