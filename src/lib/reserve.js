import { supabase } from './supabase'
import { computeCertStatus, listDocumentTypes, listAllEmployeeDocuments } from './documents'
import { getAppConfig, configInt } from './config'
import { daysBetween, todayISO } from './dates'

// Reserve pool + replacement finder logic (SPEC.md §3.4, §6.3, §6.5, §6.6).
//
// reserve_pool = base_staff WHERE eligible AND all_certs_current AND
//                availability_confirmed (live, unexpired).

// ---------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------
export async function listAvailability() {
  return supabase.from('availability').select('*')
}

// All on-base employees (no open stint), regardless of employment_status.
// Inactive staff are kept so the replacement finder can surface them as
// blocked (greyed out with a reason) rather than silently hiding them.
export async function listOnBaseEmployees() {
  return supabase
    .from('employees')
    .select(
      'id,emp_id,full_name,phone,designation_id,employment_status,current_installation_id,' +
        'base_location_type,recall_lead_time_days,' +
        'designation:designations(id,name)'
    )
    .is('current_installation_id', null)
    .order('full_name')
}

// Closed stints, to compute rest days (most recent sign-off per employee).
export async function listClosedStints() {
  return supabase
    .from('rotation_log')
    .select('employee_id,sign_off_date')
    .not('sign_off_date', 'is', null)
}

export function lastSignOffMap(closedStints) {
  const m = new Map()
  for (const s of closedStints ?? []) {
    const prev = m.get(s.employee_id)
    if (!prev || s.sign_off_date > prev) m.set(s.employee_id, s.sign_off_date)
  }
  return m
}

// Load + assemble everything both the Reserve pool and Replacement finder
// need: base candidates decorated with cert/rest/availability, plus config.
export async function loadCandidates() {
  const [baseRes, dtRes, docsRes, avRes, closedRes, cfgRes] = await Promise.all([
    listOnBaseEmployees(),
    listDocumentTypes(),
    listAllEmployeeDocuments(),
    listAvailability(),
    listClosedStints(),
    getAppConfig(),
  ])
  const error =
    baseRes.error || dtRes.error || docsRes.error || avRes.error || closedRes.error || cfgRes.error
  if (error) return { error }

  const docsByEmp = new Map()
  for (const d of docsRes.data ?? []) {
    if (!docsByEmp.has(d.employee_id)) docsByEmp.set(d.employee_id, [])
    docsByEmp.get(d.employee_id).push(d)
  }
  const avByEmp = new Map((avRes.data ?? []).map((a) => [a.employee_id, a]))
  const lastOff = lastSignOffMap(closedRes.data)
  const config = cfgRes.config
  const minRest = configInt(config, 'min_rest_days', 0)

  const candidates = buildBaseCandidates(
    baseRes.data,
    dtRes.data ?? [],
    docsByEmp,
    avByEmp,
    lastOff,
    { minRest }
  )
  return {
    candidates,
    confirmationValidityDays: configInt(config, 'confirmation_validity_days', 14),
    thresholds: {
      min: configInt(config, 'min_service_days', 56),
      warning: configInt(config, 'warning_day', 65),
      max: configInt(config, 'max_service_days', 70),
    },
    error: null,
  }
}

// ---------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------

// A confirmation counts only if confirmed AND not past its expiry (§6.6).
export function isConfirmedLive(av, now = Date.now()) {
  return Boolean(av?.confirmed && av.expires_at && new Date(av.expires_at).getTime() >= now)
}

// Rest days = today − most recent sign-off (§6.3). null = never offshore.
export function restDaysFor(employeeId, lastOffMap, today = todayISO()) {
  const off = lastOffMap.get(employeeId)
  if (!off) return null
  return Math.max(0, daysBetween(off, today))
}

// Assemble base employees into candidate objects with cert, rest, availability.
// `base` is on-base staff of any employment_status (see listOnBaseEmployees);
// inactive ones carry through so the finder can show them as blocked.
export function buildBaseCandidates(base, docTypes, docsByEmp, avByEmp, lastOffMap, { minRest = 0, today = todayISO() } = {}) {
  return (base ?? []).map((e) => {
    const cert = computeCertStatus(e.designation_id, docTypes, docsByEmp.get(e.id) ?? [], today)
    const rest = restDaysFor(e.id, lastOffMap, today)
    const eligible = rest === null || rest >= minRest
    const av = avByEmp.get(e.id) ?? null
    return { ...e, cert, restDays: rest, eligible, availability: av, liveConfirmed: isConfirmedLive(av) }
  })
}

// The strict reserve pool (§3.4): eligible AND cert-current AND live-confirmed.
export function reservePool(candidates) {
  return candidates.filter((c) => c.eligible && c.cert.certCurrent && c.liveConfirmed)
}

// Guesthouse staff are faster to recall than hometown, so within the same
// confirmation tier they rank first (SPEC.md §14.9 F). null base_location_type
// is treated as hometown (conservative default). recall_lead_time_days is
// display-only and never used in ranking.
function locationRank(c) {
  return c.base_location_type === 'guesthouse' ? 0 : 1
}

// De-emphasise repeated no-answers (§6.5/§3.6).
const NO_ANSWER_LIMIT = 3
export function isDeprioritised(c) {
  return (
    c.availability?.last_call_outcome === 'no_answer' &&
    (c.availability?.call_count ?? 0) >= NO_ANSWER_LIMIT
  )
}

// Replacement candidates for a designation: eligible + cert-current base staff,
// ranked confirmed-first, then by usefulness, then fewest calls (§6.5).
export function rankReplacementCandidates(candidates, designationId) {
  const pool = candidates.filter(
    (c) => c.designation_id === designationId && c.eligible && c.cert.certCurrent
  )
  return pool.sort((a, b) => {
    if (a.liveConfirmed !== b.liveConfirmed) return a.liveConfirmed ? -1 : 1
    const la = locationRank(a)
    const lb = locationRank(b)
    if (la !== lb) return la - lb
    const da = isDeprioritised(a)
    const db = isDeprioritised(b)
    if (da !== db) return da ? 1 : -1
    const ca = a.availability?.call_count ?? 0
    const cb = b.availability?.call_count ?? 0
    if (ca !== cb) return ca - cb
    return a.full_name.localeCompare(b.full_name)
  })
}

// Display status for a candidate: the single most important reason they are
// (or aren't) deployable. Order of precedence: inactive > cert > declined >
// resting > eligible. Used by the Base-staff list and the replacement finder.
export function candidateStatus(c) {
  if (c.employment_status === 'inactive') {
    return { key: 'inactive', label: 'Inactive', reason: 'Inactive — set active to use', blocked: true }
  }
  if (!c.cert?.certCurrent) {
    const names = (c.cert?.problems ?? []).map((p) => `${p.name} (${p.reason})`).join(', ')
    return { key: 'cert', label: 'Cert issue', reason: names || 'Certificate issue', blocked: true }
  }
  if (!c.liveConfirmed && c.availability?.last_call_outcome === 'declined') {
    return { key: 'declined', label: 'Declined', reason: 'Declined on last call', blocked: true }
  }
  if (!c.eligible) {
    const r = c.restDays != null ? `Resting — only ${c.restDays}d since sign-off` : 'Resting'
    return { key: 'resting', label: 'Resting', reason: r, blocked: true }
  }
  return { key: 'eligible', label: 'Eligible', reason: null, blocked: false }
}

// Rank order within the "available to call" group: deprioritised (repeated
// no-answer) last, then fewest calls, then name (§6.5).
function availableRank(a, b) {
  const la = locationRank(a)
  const lb = locationRank(b)
  if (la !== lb) return la - lb
  const da = isDeprioritised(a)
  const db = isDeprioritised(b)
  if (da !== db) return da ? 1 : -1
  const ca = a.availability?.call_count ?? 0
  const cb = b.availability?.call_count ?? 0
  if (ca !== cb) return ca - cb
  return a.full_name.localeCompare(b.full_name)
}

// Split a designation's candidates into the three finder sections:
//   confirmed — live-confirmed, eligible, cert-current, active (ready now)
//   available — eligible, cert-current, active, not yet confirmed (call them)
//   blocked   — anything else (cert issue / declined / resting / inactive),
//               each tagged with its blocking status for display.
export function splitReplacementGroups(candidates, designationId) {
  const pool = candidates.filter((c) => c.designation_id === designationId)
  const confirmed = []
  const available = []
  const blocked = []
  for (const c of pool) {
    const status = candidateStatus(c)
    if (status.blocked) {
      blocked.push({ ...c, status })
    } else if (c.liveConfirmed) {
      confirmed.push(c)
    } else {
      available.push(c)
    }
  }
  confirmed.sort((a, b) => {
    const la = locationRank(a)
    const lb = locationRank(b)
    if (la !== lb) return la - lb
    return (a.availability?.expires_at ?? '').localeCompare(b.availability?.expires_at ?? '')
  })
  available.sort(availableRank)
  return { confirmed, available, blocked }
}

// ---------------------------------------------------------------------
// Actions (§6.6): log a call and update availability in one go.
// Outcome 'confirmed' sets a live confirmation; 'declined' clears it.
// ---------------------------------------------------------------------
export async function logCall(
  employeeId,
  outcome,
  { notes, userId, confirmationValidityDays = 14, confirmedForDate } = {}
) {
  const nowISO = new Date().toISOString()

  const { error: callErr } = await supabase.from('call_log').insert({
    employee_id: employeeId,
    called_by: userId ?? null,
    outcome,
    notes: notes?.trim() || null,
  })
  if (callErr) return { error: callErr }

  // Read current state to increment call_count (no atomic counter at this scale).
  const { data: existing } = await supabase
    .from('availability')
    .select('call_count')
    .eq('employee_id', employeeId)
    .maybeSingle()

  const row = {
    employee_id: employeeId,
    call_count: (existing?.call_count ?? 0) + 1,
    last_call_at: nowISO,
    last_call_outcome: outcome,
    updated_by: userId ?? null,
  }
  if (outcome === 'confirmed') {
    row.confirmed = true
    row.confirmed_at = nowISO
    row.expires_at = new Date(Date.now() + confirmationValidityDays * 86400000).toISOString()
    if (confirmedForDate) row.confirmed_for_date = confirmedForDate
  } else if (outcome === 'declined') {
    row.confirmed = false
  }

  const { error: upErr } = await supabase
    .from('availability')
    .upsert(row, { onConflict: 'employee_id' })
  return { error: upErr }
}

// Confirm availability for many employees at once without going through the
// call flow (e.g. just-imported batch). Skips anyone currently offshore (they
// don't need confirmation). Does NOT touch call_count — it isn't a call.
// Returns { confirmed, skipped, error }.
export async function bulkConfirmAvailability(employees, { confirmedForDate, userId } = {}) {
  const onBase = (employees ?? []).filter((e) => !e.current_installation_id)
  const skipped = (employees ?? []).length - onBase.length
  if (onBase.length === 0) return { confirmed: 0, skipped, error: null }

  const { config } = await getAppConfig()
  const validityDays = configInt(config, 'confirmation_validity_days', 14)
  const nowISO = new Date().toISOString()
  const expiresISO = new Date(Date.now() + validityDays * 86400000).toISOString()

  const rows = onBase.map((e) => ({
    employee_id: e.id,
    confirmed: true,
    confirmed_at: nowISO,
    expires_at: expiresISO,
    confirmed_for_date: confirmedForDate || null,
    last_call_outcome: 'confirmed',
    updated_by: userId ?? null,
  }))

  const { error } = await supabase.from('availability').upsert(rows, { onConflict: 'employee_id' })
  if (error) return { confirmed: 0, skipped, error }
  return { confirmed: onBase.length, skipped, error: null }
}
