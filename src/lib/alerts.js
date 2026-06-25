import { supabase } from './supabase'
import { daysBetween, todayISO } from './dates'
import { classifyOffshoreEmployee } from './manifestPipeline'
import { loadOverdueAlerts } from './returnManifest'

// Workstream D (SPEC.md §14.7): the three Dashboard manifestation alerts.
// Takes the already-loaded employees + decorated offshore stints (each with a
// `.days` and `.employee`/`.installation`) + thresholds, runs the few
// manifest-side queries it needs, and returns the three alert groups.

const FAILED = ['dropped', 'no_show']

// Days-waiting escalation for "Awaiting re-manifest" (§14.7): 0–2 neutral,
// 3–5 amber, 6+ red.
export function waitSeverity(days) {
  if (days >= 6) return 'bad'
  if (days >= 3) return 'warn'
  return 'neutral'
}

export async function loadManifestAlerts({
  employees,
  stints,
  thresholds,
  today = todayISO(),
  includeReturnAlerts = false,
}) {
  const [liRes, pairRes, mriRes, rotRes] = await Promise.all([
    supabase.from('rfm_line_items').select('employee_id,outcome,outcome_recorded_at,created_at'),
    supabase
      .from('replacement_pairings')
      .select('outgoing_employee_id,status,consumed_at,created_at,updated_at'),
    supabase.from('manifest_request_items').select('replacing_employee_id'),
    supabase.from('rotation_log').select('employee_id,sign_on_date'),
  ])
  const error = liRes.error || pairRes.error || mriRes.error || rotRes.error
  if (error) return { error }

  const empById = new Map((employees ?? []).map((e) => [e.id, e]))

  // ---- Alert 1: Awaiting re-manifest (base-side) ----
  // The relief employee whose most recent RFM line resolved dropped/no_show,
  // who is back on base and hasn't boarded since.
  const latestLine = new Map()
  for (const li of liRes.data ?? []) {
    const stamp = li.outcome_recorded_at || li.created_at || ''
    const prev = latestLine.get(li.employee_id)
    if (!prev || stamp > prev.stamp) latestLine.set(li.employee_id, { outcome: li.outcome, stamp })
  }
  const latestSignOn = new Map()
  for (const r of rotRes.data ?? []) {
    const prev = latestSignOn.get(r.employee_id)
    if (!prev || r.sign_on_date > prev) latestSignOn.set(r.employee_id, r.sign_on_date)
  }

  const awaitingDropped = []
  const awaitingNoShow = []
  for (const [empId, line] of latestLine) {
    if (!FAILED.includes(line.outcome)) continue
    const emp = empById.get(empId)
    if (!emp || emp.employment_status !== 'active' || emp.current_installation_id) continue
    const failedDate = line.stamp.slice(0, 10)
    const signedOn = latestSignOn.get(empId)
    if (signedOn && failedDate && signedOn > failedDate) continue // boarded since
    const daysWaiting = failedDate ? Math.max(0, daysBetween(failedDate, today)) : 0
    const row = { employee: emp, daysWaiting, severity: waitSeverity(daysWaiting) }
    ;(line.outcome === 'dropped' ? awaitingDropped : awaitingNoShow).push(row)
  }
  const byWaitDesc = (a, b) => b.daysWaiting - a.daysWaiting
  awaitingDropped.sort(byWaitDesc)
  awaitingNoShow.sort(byWaitDesc)

  // ---- Alerts 2 & 3 via the shared pipeline classifier (§17.K) ----
  // Both buckets are now derived from classifyOffshoreEmployee so the Board and
  // the Dashboard can never disagree. The alert-specific day thresholds stay
  // here: "Relief failed to arrive" only fires past max_service_days (the
  // 'retry' column itself has no threshold); "Manifest needed soon" is the
  // 'needs_manifest' column (which already gates on warning_day).
  const classifyArgs = {
    manifestItems: mriRes.data ?? [],
    pairings: pairRes.data ?? [],
    warningDay: thresholds.warning,
    today,
  }
  const reliefFailed = []
  const manifestNeeded = []
  for (const s of stints) {
    const r = classifyOffshoreEmployee(s, classifyArgs)
    if (!r) continue
    if (r.column === 'retry' && s.days > thresholds.max) {
      reliefFailed.push({ stint: s, reason: r.pairing.status })
    } else if (r.column === 'needs_manifest') {
      manifestNeeded.push({ stint: s })
    }
  }
  reliefFailed.sort((a, b) => b.stint.days - a.stint.days)
  manifestNeeded.sort((a, b) => b.stint.days - a.stint.days)

  // ---- Alert 4: Return manifest overdue (§17.N, hr_manager only) ----
  // Gated behind includeReturnAlerts so the CM path can never surface it; only
  // the Dashboard (hr_manager) opts in.
  let overdueReturnTasks = []
  if (includeReturnAlerts) {
    const { data } = await loadOverdueAlerts()
    overdueReturnTasks = (data ?? [])
      .map((t) => ({ ...t, hoursOverdue: Math.floor((Date.now() - new Date(t.deadline).getTime()) / 3600000) }))
      .sort((a, b) => b.hoursOverdue - a.hoursOverdue)
  }

  return {
    error: null,
    awaitingDropped,
    awaitingNoShow,
    reliefFailed,
    manifestNeeded,
    overdueReturnTasks,
  }
}
