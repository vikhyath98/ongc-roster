import { supabase } from './supabase'
import { listOffshoreStints } from './boarding'
import { daysInclusive, todayISO } from './dates'

// Shared manifest-pipeline classifier (SPEC.md §17.K). One source of truth for
// "where is this offshore employee in the relief pipeline", consumed by both the
// Board's Flow B status columns and the Dashboard manifest alerts (alerts.js).

// Classify a single offshore stint into one of the four pipeline columns, or
// null when no action is needed yet. `stint` is a rotation_log row with the
// employee joined; `data` carries the two cross-employee tables plus the
// warning-day threshold (needed for the needs_manifest gate).
//
// Precedence: boarded > retry > filed > needs_manifest.
export function classifyOffshoreEmployee(
  stint,
  { manifestItems, pairings, warningDay = 65, today = todayISO() }
) {
  const empId = stint.employee?.id ?? stint.employee_id
  const mine = (pairings ?? []).filter((p) => p.outgoing_employee_id === empId)
  const named = (manifestItems ?? []).some((m) => m.replacing_employee_id === empId)

  // A relief that is boarded and not yet consumed = active relief this cycle.
  const activeBoarded = mine.find((p) => p.status === 'boarded' && !p.consumed_at)
  if (activeBoarded) return { column: 'boarded', pairing: activeBoarded }

  // Most recent pairing attempt (same recency rule alerts.js used).
  const latest = mine
    .slice()
    .sort((a, b) =>
      ((b.updated_at || b.created_at) ?? '').localeCompare((a.updated_at || a.created_at) ?? '')
    )[0]

  if (latest && (latest.status === 'dropped' || latest.status === 'no_show')) {
    return { column: 'retry', pairing: latest }
  }
  if (named && latest && (latest.status === 'pending' || latest.status === 'rfm_listed')) {
    return { column: 'filed', pairing: latest }
  }

  const days = daysInclusive(stint.sign_on_date, today)
  if (days >= warningDay && !named) {
    return { column: 'needs_manifest' }
  }
  return null
}

// Fetch the three sources the classifier needs, in parallel. These are the same
// tables alerts.js queries; the Board uses this loader, alerts.js reuses the
// classifier with its own already-fetched copies of the same tables.
export async function loadPipelineData() {
  const [stintRes, mriRes, pairRes] = await Promise.all([
    listOffshoreStints(),
    supabase.from('manifest_request_items').select('replacing_employee_id,manifest_request_id'),
    supabase
      .from('replacement_pairings')
      .select('outgoing_employee_id,status,consumed_at,retry_of_pairing_id,created_at,updated_at'),
  ])
  const error = stintRes.error || mriRes.error || pairRes.error
  if (error) return { error }
  return {
    stints: stintRes.data ?? [],
    manifestItems: mriRes.data ?? [],
    pairings: pairRes.data ?? [],
    error: null,
  }
}
