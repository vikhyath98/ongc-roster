import { supabase } from './supabase'
import { computeCertStatus, listDocumentTypes, listAllEmployeeDocuments } from './documents'
import { getAppConfig, configInt } from './config'
import { daysBetween, todayISO, addDays } from './dates'
import { nedpStatus } from './nedp'

// Reserve pool + replacement finder logic (SPEC.md §3.4, §6.3, §6.5, §6.6).
//
// reserve_pool = base_staff WHERE eligible AND all_certs_current AND
//                availability_confirmed (live, unexpired).

// Skill-tier compatibility for cross-designation replacement (SPEC.md §17.I).
// A candidate can fill an outgoing role only if their tier is >= the outgoing's;
// Outsourced is a closed group (only Outsourced can replace Outsourced). Tier
// names are the category names ('Skilled' / 'Semi-skilled' / 'Unskilled' /
// 'Outsourced'), reached via the designation -> category join.
const SKILL_TIER = {
  skilled: 3,
  'semi-skilled': 2,
  unskilled: 1,
  outsourced: 0,
}
function tierOf(cat) {
  return SKILL_TIER[(cat ?? '').toLowerCase()] ?? 1
}
function canReplace(outgoingCat, candidateCat) {
  const o = (outgoingCat ?? '').toLowerCase()
  const c = (candidateCat ?? '').toLowerCase()
  if (o === 'outsourced') return c === 'outsourced'
  return tierOf(c) >= tierOf(o)
}
// The skill-tier (category) name carried on an employee/candidate via its join.
const skillCategoryOf = (x) => x?.designation?.category?.name ?? null

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
        'base_location_type,recall_lead_time_days,nedp_number,nedp_valid_until,' +
        'designation:designations(id,name,category:categories(name))'
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
    // An expired NEDP blocks deployment the same way an expired cert does, so it
    // folds into `eligible` (which all consumers — finder, reserve pool, the
    // dashboard counts — already gate on). A missing NEDP is not blocking.
    const nedp = nedpStatus(e.nedp_valid_until, today)
    const eligible = (rest === null || rest >= minRest) && nedp !== 'expired'
    const av = avByEmp.get(e.id) ?? null
    return {
      ...e,
      cert,
      restDays: rest,
      nedpStatus: nedp,
      eligible,
      availability: av,
      liveConfirmed: isConfirmedLive(av),
    }
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

// Replacement candidates for an outgoing role: eligible + cert-current base
// staff whose skill tier can replace it (§17.I), ranked confirmed-first, then by
// usefulness, then fewest calls (§6.5).
export function rankReplacementCandidates(candidates, outgoingCategory) {
  const pool = candidates.filter(
    (c) => canReplace(outgoingCategory, skillCategoryOf(c)) && c.eligible && c.cert.certCurrent
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
// (or aren't) deployable. Order of precedence: inactive > cert > NEDP > declined
// > resting > eligible. Used by the Base-staff list and the replacement finder.
export function candidateStatus(c) {
  if (c.employment_status === 'inactive') {
    return { key: 'inactive', label: 'Inactive', reason: 'Inactive — set active to use', blocked: true }
  }
  if (!c.cert?.certCurrent) {
    const names = (c.cert?.problems ?? []).map((p) => `${p.name} (${p.reason})`).join(', ')
    return { key: 'cert', label: 'Cert issue', reason: names || 'Certificate issue', blocked: true }
  }
  if (c.nedpStatus === 'expired') {
    return { key: 'nedp', label: 'NEDP expired', reason: 'NEDP expired', blocked: true }
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

// Split the candidates a given outgoing role can be replaced by into the three
// finder sections:
//   confirmed — live-confirmed, eligible, cert-current, active (ready now)
//   available — eligible, cert-current, active, not yet confirmed (call them)
//   blocked   — anything else (cert issue / declined / resting / inactive),
//               each tagged with its blocking status for display.
// Eligibility is now skill-tier based (§17.I): a candidate is in the pool iff
// their tier can replace `outgoingCategory`. This is the single eligibility gate
// (it subsumes the old exact-designation match — a same-designation candidate is
// always same-tier, so still passes). Same-tier cross-designation is included
// without a warning, intentional per ops.
export function splitReplacementGroups(candidates, outgoingCategory) {
  const pool = candidates.filter((c) => canReplace(outgoingCategory, skillCategoryOf(c)))
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
// Calls (§6.6 / Workstream L "Model A"). A call is recorded in two steps so the
// UI can capture the outcome (and the confirmation details) after the call has
// actually been placed: createCall() logs the attempt, setCallOutcome() records
// how it went. logCall() below stitches both together for older callers.
// ---------------------------------------------------------------------

// Step 1: log a placed call immediately, before its outcome is known. Bumps the
// call counter exactly once here — setCallOutcome must NOT touch call_count.
// Returns the new call_log id.
export async function createCall(employeeId, { userId } = {}) {
  const nowISO = new Date().toISOString()
  const { data: call, error: callErr } = await supabase
    .from('call_log')
    .insert({ employee_id: employeeId, called_by: userId ?? null, outcome: null })
    .select('id')
    .single()
  if (callErr) return { error: callErr }

  // Read current count to increment (no atomic counter needed at this scale).
  const { data: existing } = await supabase
    .from('availability')
    .select('call_count')
    .eq('employee_id', employeeId)
    .maybeSingle()

  const { error: upErr } = await supabase.from('availability').upsert(
    {
      employee_id: employeeId,
      call_count: (existing?.call_count ?? 0) + 1,
      last_call_at: nowISO,
      updated_by: userId ?? null,
    },
    { onConflict: 'employee_id' }
  )
  if (upErr) return { error: upErr }
  return { id: call.id, error: null }
}

// Step 2: record the outcome of a placed call (by call_log id). Mirrors the
// outcome onto availability.last_call_outcome; a 'confirmed' outcome opens a live
// confirmation (valid 7 days from the commitment date — Model A), a 'declined'
// one clears any confirmation. Never changes call_count.
export async function setCallOutcome(
  callId,
  employeeId,
  outcome,
  { notes, commitmentDate, hometown, travelDays, userId } = {}
) {
  const nowISO = new Date().toISOString()

  const { error: callErr } = await supabase
    .from('call_log')
    .update({
      outcome,
      notes: notes?.trim() || null,
      commitment_date: commitmentDate || null,
      hometown: hometown?.trim() || null,
      travel_days: travelDays === '' || travelDays == null ? null : Number(travelDays),
    })
    .eq('id', callId)
  if (callErr) return { error: callErr }

  const row = {
    employee_id: employeeId,
    last_call_outcome: outcome,
    updated_by: userId ?? null,
  }
  if (outcome === 'confirmed') {
    // Confirmation window = commitment date + the configured validity period
    // (same app_config key the rest of the confirm flow uses).
    const { config } = await getAppConfig()
    const validityDays = configInt(config, 'confirmation_validity_days', 14)
    row.confirmed = true
    row.confirmed_at = nowISO
    row.confirmed_for_date = commitmentDate || null
    row.expires_at = addDays(commitmentDate || todayISO(), validityDays)
  } else if (outcome === 'declined') {
    row.confirmed = false
  }

  const { error: upErr } = await supabase
    .from('availability')
    .upsert(row, { onConflict: 'employee_id' })
  return { error: upErr }
}

// Deprecated single-shot wrapper kept so the Base-staff CallDialog keeps working
// unchanged: create the call, then immediately record its outcome. The
// confirmation window now follows Model A (commitment date + 7 days);
// confirmedForDate maps to the commitment date.
export async function logCall(employeeId, outcome, { notes, userId, confirmedForDate } = {}) {
  const { id, error } = await createCall(employeeId, { userId })
  if (error) return { error }
  return setCallOutcome(id, employeeId, outcome, { notes, commitmentDate: confirmedForDate, userId })
}

// Full call history for one employee, newest first, with the caller's name.
export async function listCallLog(employeeId) {
  return supabase
    .from('call_log')
    .select(
      'id,called_at,outcome,notes,commitment_date,hometown,travel_days,' +
        'caller:app_users(full_name)'
    )
    .eq('employee_id', employeeId)
    .order('called_at', { ascending: false })
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
