import { supabase } from './supabase'
import { returnManifestDeadline } from './dates'

// Return manifest tasks (SPEC.md §17.N, Workstream N). The Segment-2 prevention
// flow: a boarded relief creates a task for the outgoing employee; the catering
// manager files the ONGC return RFM or submits a reason; overdue pending tasks
// raise an hr_manager Dashboard alert.

const EMP_SELECT =
  'outgoing:employees(id,emp_id,full_name,designation:designations(id,name)),' +
  'installation:installations(id,name)'

// Create the return task for a just-boarded pairing. Fire-and-forget from the
// boarding paths — the UNIQUE index on replacement_pairing_id makes a repeated
// call a no-op (unique violation, surfaced as { error } for the caller to log).
export async function createReturnTask(pairingId, outgoingEmployeeId, installationId, boardedAt) {
  const { error } = await supabase.from('return_manifest_tasks').insert({
    replacement_pairing_id: pairingId,
    outgoing_employee_id: outgoingEmployeeId,
    installation_id: installationId,
    deadline: returnManifestDeadline(boardedAt),
  })
  return { error }
}

// All return tasks for the given installations (the CM's scope). Sorted: overdue
// pending first, then pending by deadline asc, then filed/submitted last.
export async function loadReturnTasks(installationIds) {
  if (!installationIds || installationIds.length === 0) return { data: [], error: null }
  const { data, error } = await supabase
    .from('return_manifest_tasks')
    .select(`id,status,deadline,return_rfm_number,return_sortie_date,reason,created_at,${EMP_SELECT}`)
    .in('installation_id', installationIds)
  if (error) return { data: [], error }

  const now = Date.now()
  const rank = (t) => {
    if (t.status !== 'pending') return 2 // filed / submitted last
    return new Date(t.deadline).getTime() < now ? 0 : 1 // overdue pending, then upcoming
  }
  const sorted = [...(data ?? [])].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
  })
  return { data: sorted, error: null }
}

// File the ONGC return manifest: records the return RFM number + sortie date.
export async function fileReturnManifest(taskId, { returnRfmNumber, returnSortieDate, userId }) {
  const { error } = await supabase
    .from('return_manifest_tasks')
    .update({
      status: 'filed',
      return_rfm_number: returnRfmNumber?.trim() || null,
      return_sortie_date: returnSortieDate || null,
      filed_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
  return { error }
}

// Close an overdue task with a reason instead of a filed manifest. Only valid
// while still pending (enforced here, not in the DB) — guards against racing a
// File action.
export async function submitReason(taskId, { reason, userId }) {
  const { data: task, error: readErr } = await supabase
    .from('return_manifest_tasks')
    .select('status')
    .eq('id', taskId)
    .single()
  if (readErr) return { error: readErr }
  if (task.status !== 'pending') {
    return { error: { message: 'Task is no longer pending.' } }
  }
  const { error } = await supabase
    .from('return_manifest_tasks')
    .update({
      status: 'submitted',
      reason: reason?.trim() || null,
      submitted_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
  return { error }
}

// Overdue pending tasks across all installations — the hr_manager Dashboard
// alert (SPEC.md §17.N). Not installation-scoped: HR sees every overdue task.
export async function loadOverdueAlerts() {
  const { data, error } = await supabase
    .from('return_manifest_tasks')
    .select(`id,deadline,${EMP_SELECT}`)
    .eq('status', 'pending')
    .lt('deadline', new Date().toISOString())
  if (error) return { data: [], error }
  return { data: data ?? [], error: null }
}
