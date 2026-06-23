import { supabase } from './supabase'
import { todayISO, addDays, daysBetween } from './dates'
import { listEmployees } from './employees'
import { listAllEmployeeDocuments, listDocumentTypes, dobMismatch } from './documents'

const loadXLSX = () => import('xlsx')

// Reports data layer (SPEC.md §14.8, Workstream E). The evidence chain-walk is
// shared by the in-app "View evidence" modal (single case) and the
// Reconciliation Report (multi case) so both tell the identical story.

const OUTCOME_LABEL = {
  listed: 'Listed',
  boarded: 'Boarded',
  dropped: 'Dropped',
  no_show: 'No-show',
}
export const ATTR_LABEL = { ongc: 'ONGC', skfs: 'SKFS' }

// One pairing in a relief chain, with its request date + RFM line resolved.
const PAIRING_SELECT =
  'id,status,retry_of_pairing_id,incoming_employee_id,outgoing_employee_id,' +
  'manifest_request_item:manifest_request_items(' +
  'manifest_request:manifest_requests(request_date)),' +
  'rfm_line_item:rfm_line_items(outcome,outcome_recorded_at,' +
  'rfm:rfms(rfm_number,sortie_date))'

function toChainNode(p) {
  return {
    status: p.status,
    requestDate: p.manifest_request_item?.manifest_request?.request_date ?? null,
    rfmNumber: p.rfm_line_item?.rfm?.rfm_number ?? null,
    sortieDate: p.rfm_line_item?.rfm?.sortie_date ?? null,
    outcome: p.rfm_line_item?.outcome ?? null,
    outcomeRecordedAt: p.rfm_line_item?.outcome_recorded_at ?? null,
  }
}

// Walk retry_of_pairing_id from the anchor pairing back to the root, returning
// the attempts oldest-first. Fetches every pairing for the outgoing employee
// once, then follows the chain in memory (chains are short, but this keeps it
// to two round-trips regardless of length and avoids any cycle risk).
async function walkPairingChain(anchorId) {
  const { data: anchor, error: aErr } = await supabase
    .from('replacement_pairings')
    .select('id,outgoing_employee_id')
    .eq('id', anchorId)
    .maybeSingle()
  if (aErr || !anchor) return { chain: [], error: aErr ?? null }

  const { data: rows, error: rErr } = await supabase
    .from('replacement_pairings')
    .select(PAIRING_SELECT)
    .eq('outgoing_employee_id', anchor.outgoing_employee_id)
  if (rErr) return { chain: [], error: rErr }

  const byId = new Map((rows ?? []).map((p) => [p.id, p]))
  const seq = []
  const seen = new Set()
  let cur = byId.get(anchorId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    seq.push(cur)
    cur = cur.retry_of_pairing_id ? byId.get(cur.retry_of_pairing_id) : null
  }
  seq.reverse() // chronological: earliest attempt first
  return { chain: seq.map(toChainNode), error: null }
}

// Plain-language narrative across the whole retry chain, oldest attempt first.
export function buildNarrative(chain) {
  if (!chain.length) return 'No manifest request filed; no RFM received.'
  return chain
    .map((n, i) => {
      const label = chain.length > 1 ? `Attempt ${i + 1}: ` : ''
      const req = n.requestDate
        ? `Replacement requested on ${n.requestDate}.`
        : 'No manifest request filed.'
      let rfm
      if (n.rfmNumber) {
        const sortie = n.sortieDate ? ` issued ${n.sortieDate}` : ''
        const outcome = OUTCOME_LABEL[n.outcome] ?? n.outcome ?? 'listed'
        rfm = ` RFM #${n.rfmNumber}${sortie}: ${outcome}.`
      } else {
        rfm = ' No RFM received.'
      }
      return `${label}${req}${rfm}`
    })
    .join(' ')
}

// Everything the evidence view (and report row) needs for one overstay stint:
// the attribution split, the full relief chain, RFM numbers, reconciliation
// status, and the generated narrative.
export async function getEvidenceForStint(rotationLogId) {
  const { data: attr, error: attrErr } = await supabase
    .from('overstay_attributions')
    .select(
      'replacement_pairing_id,segment_1_days,segment_1_attribution,segment_1_overridden,' +
        'segment_1_remark,segment_2_days,segment_2_attribution,segment_2_overridden,segment_2_remark'
    )
    .eq('rotation_log_id', rotationLogId)
    .maybeSingle()
  if (attrErr) return { error: attrErr }

  const { data: pen, error: penErr } = await supabase
    .from('penalty_log')
    .select('reconciliation_remark,reconciled_at')
    .eq('rotation_log_id', rotationLogId)
    .eq('status', 'reconciled')
    .maybeSingle()
  if (penErr) return { error: penErr }

  let chain = []
  if (attr?.replacement_pairing_id) {
    const res = await walkPairingChain(attr.replacement_pairing_id)
    if (res.error) return { error: res.error }
    chain = res.chain
  }

  const attribution = attr
    ? {
        seg1Days: attr.segment_1_days,
        seg1Attr: attr.segment_1_attribution,
        seg1Overridden: attr.segment_1_overridden,
        seg1Remark: attr.segment_1_remark,
        seg2Days: attr.segment_2_days,
        seg2Attr: attr.segment_2_attribution,
        seg2Overridden: attr.segment_2_overridden,
        seg2Remark: attr.segment_2_remark,
      }
    : null

  return {
    error: null,
    attribution,
    chain,
    rfmNumbers: [...new Set(chain.map((c) => c.rfmNumber).filter(Boolean))],
    reconciliation: pen
      ? { reconciled: true, remark: pen.reconciliation_remark, reconciledAt: pen.reconciled_at }
      : { reconciled: false },
    narrative: buildNarrative(chain),
  }
}

// ---------------------------------------------------------------------
// Reconciliation Report (multi-case, §14.8)
// ---------------------------------------------------------------------

// Signed-off (finalised=true) overstay stints from the penalty_exposure view,
// filtered by sign-off date range, installation, and reconciliation status.
// Returns the filtered rows + a reconciled-by-stint map for the report build.
async function fetchFilteredExposure({ installationId, dateFrom, dateTo, status } = {}) {
  let q = supabase.from('penalty_exposure').select('*').eq('finalised', true)
  if (installationId) q = q.eq('installation_id', installationId)
  if (dateFrom) q = q.gte('sign_off_date', dateFrom)
  if (dateTo) q = q.lte('sign_off_date', dateTo)
  const { data: rows, error } = await q.order('sign_off_date', { ascending: false })
  if (error) return { error }

  const { data: recs, error: recErr } = await supabase
    .from('penalty_log')
    .select('rotation_log_id,reconciliation_remark,reconciled_at')
    .eq('status', 'reconciled')
  if (recErr) return { error: recErr }
  const recById = new Map((recs ?? []).map((r) => [r.rotation_log_id, r]))

  let filtered = rows ?? []
  if (status === 'reconciled') filtered = filtered.filter((r) => recById.has(r.rotation_log_id))
  else if (status === 'unreconciled') filtered = filtered.filter((r) => !recById.has(r.rotation_log_id))

  return { filtered, recById, error: null }
}

// Cheap preview count — exposure + status filter only, no per-row evidence walk.
export async function getReconciliationCount(filters) {
  const res = await fetchFilteredExposure(filters)
  if (res.error) return { error: res.error }
  return { count: res.filtered.length, error: null }
}

// Full report: one assembled row per signed-off overstay stint. ongc/skfs
// penalties are derived from the attribution segments × the stint's
// daily_penalty_rate; total_penalty is always taken from the view unchanged
// (the parts may not sum for pre-attribution stints — that's expected).
export async function getReconciliationReportData(filters) {
  const res = await fetchFilteredExposure(filters)
  if (res.error) return { error: res.error }

  const out = []
  for (const r of res.filtered) {
    const ev = await getEvidenceForStint(r.rotation_log_id)
    const a = ev?.attribution ?? null
    const rate = Number(r.daily_penalty_rate || 0)

    let ongcDays = 0
    let skfsDays = 0
    if (a) {
      if (a.seg1Attr === 'ongc') ongcDays += a.seg1Days
      else if (a.seg1Attr === 'skfs') skfsDays += a.seg1Days
      if (a.seg2Attr === 'ongc') ongcDays += a.seg2Days
      else if (a.seg2Attr === 'skfs') skfsDays += a.seg2Days
    }

    const rec = res.recById.get(r.rotation_log_id)
    out.push({
      full_name: r.full_name,
      emp_id: r.emp_id,
      designation_name: r.designation_name,
      installation_name: r.installation_name,
      sign_on_date: r.sign_on_date,
      sign_off_date: r.sign_off_date,
      days_served: r.days_served,
      days_over: r.days_over,
      seg1Days: a ? a.seg1Days : '',
      seg1Attr: a?.seg1Attr ? ATTR_LABEL[a.seg1Attr] : '',
      seg2Days: a ? a.seg2Days : '',
      seg2Attr: a?.seg2Attr ? ATTR_LABEL[a.seg2Attr] : '',
      ongcPenalty: a ? ongcDays * rate : '',
      skfsPenalty: a ? skfsDays * rate : '',
      totalPenalty: Number(r.total_penalty || 0),
      rfmNumbers: ev?.rfmNumbers ?? [],
      reconciled: Boolean(rec),
      reconciliationRemark: rec?.reconciliation_remark ?? '',
      narrative: ev?.narrative ?? '',
    })
  }
  return { rows: out, error: null }
}

const RECON_HEADERS = [
  'Employee Name', 'Emp ID', 'Designation', 'Installation',
  'Sign-on Date', 'Sign-off Date', 'Days Served', 'Days Over',
  'Seg 1 Days', 'Seg 1 Attribution', 'Seg 2 Days', 'Seg 2 Attribution',
  'ONGC Penalty (₹)', 'SKFS Penalty (₹)', 'Total Penalty (₹)',
  'RFM Number(s)', 'Reconciled', 'Reconciliation Remark', 'Narrative',
]

// Run the full report and download it as .xlsx (same SheetJS dynamic-import
// pattern as importEmployees.js). Returns { count } so the UI can confirm.
export async function downloadReconciliationXlsx(filters) {
  const res = await getReconciliationReportData(filters)
  if (res.error) return { error: res.error }

  const XLSX = await loadXLSX()
  const aoa = [RECON_HEADERS]
  for (const r of res.rows) {
    aoa.push([
      r.full_name, r.emp_id, r.designation_name, r.installation_name,
      r.sign_on_date, r.sign_off_date, r.days_served, r.days_over,
      r.seg1Days, r.seg1Attr, r.seg2Days, r.seg2Attr,
      r.ongcPenalty, r.skfsPenalty, r.totalPenalty,
      r.rfmNumbers.join(', '), r.reconciled ? 'Yes' : 'No',
      r.reconciliationRemark, r.narrative,
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation')
  XLSX.writeFile(wb, `reconciliation_report_${todayISO()}.xlsx`)
  return { count: res.rows.length, error: null }
}

// ---------------------------------------------------------------------
// DOB Mismatch Report (§14.8 / §14.9 H)
// ---------------------------------------------------------------------

// Employees (active AND inactive — it's a data-quality issue independent of
// status) whose identity-document DOBs disagree, with the three named docs'
// DOBs looked up by their exact seeded names.
export async function getDobMismatchData() {
  const [empRes, docsRes, dtRes] = await Promise.all([
    listEmployees(),
    listAllEmployeeDocuments(),
    listDocumentTypes(),
  ])
  const err = empRes.error || docsRes.error || dtRes.error
  if (err) return { error: err }

  const docTypes = dtRes.data ?? []
  const idByName = new Map(docTypes.map((dt) => [dt.name, dt.id]))
  const aadhaarId = idByName.get('Aadhaar Card')
  const panId = idByName.get('PAN Card')
  const passportId = idByName.get('Passport')

  const docsByEmp = new Map()
  for (const d of docsRes.data ?? []) {
    if (!docsByEmp.has(d.employee_id)) docsByEmp.set(d.employee_id, [])
    docsByEmp.get(d.employee_id).push(d)
  }

  const rows = []
  for (const e of empRes.data ?? []) {
    const empDocs = docsByEmp.get(e.id) ?? []
    if (!dobMismatch(empDocs, docTypes).mismatch) continue
    const dobOf = (typeId) =>
      typeId ? empDocs.find((d) => d.document_type_id === typeId)?.date_of_birth ?? '' : ''
    rows.push({
      emp_id: e.emp_id,
      full_name: e.full_name,
      designation_name: e.designation?.name ?? '',
      locationStatus: e.current_installation_id
        ? e.installation?.name ?? 'Offshore'
        : e.employment_status === 'inactive'
          ? 'Inactive'
          : 'On base',
      aadhaarDob: dobOf(aadhaarId),
      panDob: dobOf(panId),
      passportDob: dobOf(passportId),
    })
  }
  return { rows, error: null }
}

const DOB_HEADERS = [
  'Emp ID', 'Full Name', 'Designation', 'Installation / Status',
  'Aadhaar DOB', 'PAN DOB', 'Passport DOB',
]

export async function downloadDobMismatchXlsx() {
  const res = await getDobMismatchData()
  if (res.error) return { error: res.error }

  const XLSX = await loadXLSX()
  const aoa = [DOB_HEADERS]
  for (const r of res.rows) {
    aoa.push([
      r.emp_id, r.full_name, r.designation_name, r.locationStatus,
      r.aadhaarDob, r.panDob, r.passportDob,
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'DOB Mismatch')
  XLSX.writeFile(wb, `dob_mismatch_report_${todayISO()}.xlsx`)
  return { count: res.rows.length, error: null }
}

// ---------------------------------------------------------------------
// Call Performance Report (Workstream L)
// Per active on-base employee, over the last 365 days: call volume, confirmed
// calls, no-shows (from RFM line items), on-time arrival rate, and average rest
// days between stints. Decisions locked in §17.L.
// ---------------------------------------------------------------------

const BASE_LOCATION_LABEL = { guesthouse: 'Guesthouse', hometown: 'Out of town' }

function groupByKey(rows, key) {
  const m = new Map()
  for (const r of rows ?? []) {
    if (!m.has(r[key])) m.set(r[key], [])
    m.get(r[key]).push(r)
  }
  return m
}

export async function getCallPerformanceData() {
  const cutoff = addDays(todayISO(), -365)

  const empRes = await listEmployees()
  if (empRes.error) return { error: empRes.error }
  const base = (empRes.data ?? []).filter(
    (e) => e.employment_status === 'active' && !e.current_installation_id
  )
  if (base.length === 0) return { rows: [], error: null }
  const ids = base.map((e) => e.id)

  const [callRes, rotRes, nsRes] = await Promise.all([
    supabase
      .from('call_log')
      .select('employee_id,outcome,commitment_date,called_at')
      .in('employee_id', ids)
      .gte('called_at', cutoff),
    supabase
      .from('rotation_log')
      .select('employee_id,sign_on_date,sign_off_date')
      .in('employee_id', ids)
      .order('sign_on_date'),
    supabase
      .from('rfm_line_items')
      .select('employee_id,outcome,outcome_recorded_at')
      .eq('outcome', 'no_show')
      .gte('outcome_recorded_at', cutoff)
      .in('employee_id', ids),
  ])
  const err = callRes.error || rotRes.error || nsRes.error
  if (err) return { error: err }

  const callsByEmp = groupByKey(callRes.data, 'employee_id')
  const rotByEmp = groupByKey(rotRes.data, 'employee_id')
  const noShowByEmp = groupByKey(nsRes.data, 'employee_id')

  const rows = base.map((e) => {
    const calls = callsByEmp.get(e.id) ?? []
    const rots = (rotByEmp.get(e.id) ?? [])
      .slice()
      .sort((a, b) => (a.sign_on_date ?? '').localeCompare(b.sign_on_date ?? ''))
    const signOns = rots.map((r) => r.sign_on_date).filter(Boolean)

    const totalCalls = calls.length
    const confirmedCalls = calls.filter((c) => c.outcome === 'confirmed').length
    const noShows = (noShowByEmp.get(e.id) ?? []).length

    // On-time rate: among confirmed calls that have a commitment date, pair each
    // with the nearest stint that started on/after the call; on-time if that
    // sign-on falls within 30 days of the commitment date. Confirmed calls with
    // no commitment date are excluded from the rate entirely.
    const eligible = calls.filter((c) => c.outcome === 'confirmed' && c.commitment_date)
    let onTime = 0
    for (const c of eligible) {
      const callDate = (c.called_at ?? '').slice(0, 10)
      const nextSignOn = signOns.find((d) => d >= callDate)
      if (nextSignOn && nextSignOn <= addDays(c.commitment_date, 30)) onTime++
    }
    const onTimeRate = eligible.length ? Math.round((onTime / eligible.length) * 100) : null

    // Avg rest days: average gap between a stint's sign-off and the next sign-on.
    const gaps = []
    for (let i = 1; i < rots.length; i++) {
      const prevOff = rots[i - 1].sign_off_date
      const nextOn = rots[i].sign_on_date
      if (prevOff && nextOn) gaps.push(daysBetween(prevOff, nextOn))
    }
    const avgRest =
      rots.length >= 2 && gaps.length
        ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
        : null

    return {
      emp_id: e.emp_id,
      full_name: e.full_name,
      designation_name: e.designation?.name ?? '',
      base_location: BASE_LOCATION_LABEL[e.base_location_type] ?? '',
      total_calls: totalCalls,
      confirmed_calls: confirmedCalls,
      no_shows: noShows,
      on_time_rate: onTimeRate,
      avg_rest_days: avgRest,
    }
  })

  rows.sort((a, b) => b.total_calls - a.total_calls)
  return { rows, error: null }
}

const CALLPERF_HEADERS = [
  'Emp ID', 'Full Name', 'Designation', 'Base Location Type',
  'Total Calls (12 mo)', 'Confirmed Calls', 'No-shows (12 mo)',
  'On-time Rate (%)', 'Avg Rest Days Between Stints',
]

export async function downloadCallPerformanceXlsx() {
  const res = await getCallPerformanceData()
  if (res.error) return { error: res.error }

  const XLSX = await loadXLSX()
  const aoa = [CALLPERF_HEADERS]
  for (const r of res.rows) {
    aoa.push([
      r.emp_id, r.full_name, r.designation_name, r.base_location,
      r.total_calls, r.confirmed_calls, r.no_shows,
      r.on_time_rate == null ? '' : r.on_time_rate,
      r.avg_rest_days == null ? '' : r.avg_rest_days,
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Call Performance')
  XLSX.writeFile(wb, `call_performance_report_${todayISO()}.xlsx`)
  return { count: res.rows.length, error: null }
}
