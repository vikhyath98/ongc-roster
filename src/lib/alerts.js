import { supabase } from './supabase'
import { daysBetween, todayISO } from './dates'

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

export async function loadManifestAlerts({ employees, stints, thresholds, today = todayISO() }) {
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

  // ---- Alert 2: Relief failed to arrive (offshore-side) ----
  // Offshore past max, whose most recent relief pairing resolved dropped/no_show
  // with no successor boarded yet (so we know WHY they're still overdue).
  const pairsByOut = new Map()
  for (const p of pairRes.data ?? []) {
    if (!pairsByOut.has(p.outgoing_employee_id)) pairsByOut.set(p.outgoing_employee_id, [])
    pairsByOut.get(p.outgoing_employee_id).push(p)
  }
  const reliefFailed = []
  for (const s of stints) {
    if (s.days <= thresholds.max) continue
    const ps = pairsByOut.get(s.employee?.id) ?? []
    if (ps.length === 0) continue
    if (ps.some((p) => p.status === 'boarded' && !p.consumed_at)) continue // relief in motion
    const latest = ps
      .slice()
      .sort((a, b) =>
        ((b.updated_at || b.created_at) ?? '').localeCompare((a.updated_at || a.created_at) ?? '')
      )[0]
    if (!latest || !FAILED.includes(latest.status)) continue
    reliefFailed.push({ stint: s, reason: latest.status })
  }
  reliefFailed.sort((a, b) => b.stint.days - a.stint.days)

  // ---- Alert 3: Manifest needed soon ----
  // Offshore, past warning_day, never named in any manifest_request_item.
  const everNamed = new Set(
    (mriRes.data ?? []).map((m) => m.replacing_employee_id).filter(Boolean)
  )
  const manifestNeeded = []
  for (const s of stints) {
    if (s.days < thresholds.warning) continue
    if (everNamed.has(s.employee?.id)) continue
    manifestNeeded.push({ stint: s })
  }
  manifestNeeded.sort((a, b) => b.stint.days - a.stint.days)

  return { error: null, awaitingDropped, awaitingNoShow, reliefFailed, manifestNeeded }
}
