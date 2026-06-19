import { supabase } from './supabase'
import { todayISO } from './dates'

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
