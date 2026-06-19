import { supabase } from './supabase'

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
