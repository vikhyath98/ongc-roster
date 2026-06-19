import { supabase } from './supabase'
import { getAppConfig, configInt } from './config'
import { daysInclusive, daysBetween, addDays } from './dates'

// Offboard-time checks layered on top of the existing penalty computation
// (migration 0006). Understay = signed off under the minimum; overstay = over
// the hard threshold, split into two attributed segments. Neither changes the
// base penalty amount — they are additive records.

export async function offboardConfig() {
  const { config } = await getAppConfig()
  const num = (k) => {
    const n = Number(config?.[k])
    return Number.isFinite(n) ? n : 0
  }
  return {
    min: configInt(config, 'min_service_days', 56),
    warning: configInt(config, 'warning_day', 65),
    max: configInt(config, 'max_service_days', 70),
    grace: configInt(config, 'relief_grace_period_days', 1),
    understayFixed: num('understay_fixed_cost'),
    understayDaily: num('understay_daily_rate'),
  }
}

// Pre-fill the understay reason from the most recent emergency-exception
// manifest item that named this employee as the one being replaced.
export async function understayPrefillReason(employeeId) {
  const { data } = await supabase
    .from('manifest_request_items')
    .select('exception_reason,created_at')
    .eq('replacing_employee_id', employeeId)
    .eq('is_emergency_exception', true)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0]?.exception_reason ?? ''
}

// The active relief pairing for an offboarding employee — found the same way
// no matter which path created it (formal request, manual onboard, ad-hoc RFM):
// they all converge on status 'boarded' with this employee as the outgoing.
export async function activeBoardedPairing(outgoingEmployeeId) {
  const { data } = await supabase
    .from('replacement_pairings')
    .select(
      'id,incoming_employee_id,retry_of_pairing_id,manifest_request_item_id,rfm_line_item_id,relief_deadline'
    )
    .eq('outgoing_employee_id', outgoingEmployeeId)
    .eq('status', 'boarded')
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

// Relief arrival date, taken from the pairing's authoritative source rather than
// the incoming employee's latest rotation_log sign-on (which goes stale once
// that employee starts a later, unrelated rotation):
//   - RFM-boarded pairing -> the linked RFM's sortie_date (grace-independent).
//   - Manual onboard (no RFM) -> relief_deadline was frozen at boarding as
//     sign_on + grace, so the arrival is relief_deadline − grace.
async function reliefArrivalDate(pairing, graceDays) {
  if (pairing.rfm_line_item_id) {
    const { data } = await supabase
      .from('rfm_line_items')
      .select('rfm:rfms(sortie_date)')
      .eq('id', pairing.rfm_line_item_id)
      .single()
    return data?.rfm?.sortie_date ?? null
  }
  if (pairing.relief_deadline) return addDays(pairing.relief_deadline, -graceDays)
  return null
}

async function pairingStatus(pairingId) {
  if (!pairingId) return null
  const { data } = await supabase
    .from('replacement_pairings')
    .select('status')
    .eq('id', pairingId)
    .single()
  return data?.status ?? null
}

async function requestDateForItem(manifestRequestItemId) {
  if (!manifestRequestItemId) return null
  const { data } = await supabase
    .from('manifest_request_items')
    .select('manifest_request:manifest_requests(request_date)')
    .eq('id', manifestRequestItemId)
    .single()
  return data?.manifest_request?.request_date ?? null
}

// Mark the outgoing employee's active relief pairing as consumed at their
// offboard (any outcome). The overstay path consumes by id instead.
export async function consumeActivePairing(outgoingEmployeeId) {
  const pairing = await activeBoardedPairing(outgoingEmployeeId)
  if (!pairing) return { error: null }
  const { error } = await supabase
    .from('replacement_pairings')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', pairing.id)
  return { error }
}

// Compute the two overstay segments and their default attributions for a stint
// that has crossed the hard threshold. signOffDate is the date being recorded.
export async function computeOverstay(stint, cfg, signOffDate) {
  const signOn = stint.sign_on_date
  const employeeId = stint.employee?.id ?? stint.employee_id
  // Date on which days_served equals max (inclusive: day 1 = sign-on).
  const hardThreshold = addDays(signOn, cfg.max - 1)

  const pairing = await activeBoardedPairing(employeeId)

  if (!pairing) {
    // No relief was ever boarded — the whole overstay is segment 1, SKFS.
    return {
      pairingId: null,
      reliefArrival: null,
      hardThreshold,
      seg1Days: Math.max(0, daysBetween(hardThreshold, signOffDate)),
      seg2Days: 0,
      seg1Default: 'skfs',
      seg2Default: null,
    }
  }

  const reliefArrival = await reliefArrivalDate(pairing, cfg.grace)
  let seg1Days
  let seg2Days
  if (reliefArrival) {
    seg1Days = Math.max(0, daysBetween(hardThreshold, reliefArrival))
    const seg2Start = reliefArrival > hardThreshold ? reliefArrival : hardThreshold
    seg2Days = Math.max(0, daysBetween(seg2Start, signOffDate))
  } else {
    seg1Days = Math.max(0, daysBetween(hardThreshold, signOffDate))
    seg2Days = 0
  }

  // Segment 1 default: prior failed attempt drives it; otherwise the original
  // request's filing window does.
  let seg1Default
  const priorStatus = await pairingStatus(pairing.retry_of_pairing_id)
  if (priorStatus === 'dropped') seg1Default = 'ongc'
  else if (priorStatus === 'no_show') seg1Default = 'skfs'
  else {
    const reqDate = await requestDateForItem(pairing.manifest_request_item_id)
    if (reqDate) {
      const daysAtRequest = daysInclusive(signOn, reqDate)
      seg1Default = daysAtRequest >= cfg.min && daysAtRequest <= cfg.warning ? 'ongc' : 'skfs'
    } else {
      // Manual / ad-hoc first attempt with no request to check — default SKFS.
      seg1Default = 'skfs'
    }
  }

  // Segment 2 (any post-relief delay) always defaults to ONGC.
  const seg2Default = seg2Days > 0 ? 'ongc' : null

  return { pairingId: pairing.id, reliefArrival, hardThreshold, seg1Days, seg2Days, seg1Default, seg2Default }
}

// Persist the overstay attribution and consume the pairing.
export async function recordOverstay(
  stint,
  result,
  { seg1Attr, seg1Remark, seg2Attr, seg2Remark, userId }
) {
  const seg1Changed = seg1Attr !== result.seg1Default
  const hasSeg2 = result.seg2Days > 0
  const seg2Changed = hasSeg2 && seg2Attr !== result.seg2Default

  const { error } = await supabase.from('overstay_attributions').insert({
    rotation_log_id: stint.id,
    replacement_pairing_id: result.pairingId,
    segment_1_days: result.seg1Days,
    segment_1_attribution: seg1Attr,
    segment_1_overridden: seg1Changed,
    segment_1_remark: seg1Changed ? seg1Remark?.trim() || null : null,
    segment_2_days: result.seg2Days,
    segment_2_attribution: hasSeg2 ? seg2Attr : null,
    segment_2_overridden: seg2Changed,
    segment_2_remark: seg2Changed ? seg2Remark?.trim() || null : null,
    created_by: userId ?? null,
  })
  if (error) return { error }

  if (result.pairingId) {
    // Previously the result of this update was discarded, so a failure here
    // (e.g. RLS, FK) was swallowed and the caller saw success. Surface it.
    const { error: consumeErr } = await supabase
      .from('replacement_pairings')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', result.pairingId)
    if (consumeErr) return { error: consumeErr }
  }
  return { error: null }
}

// Persist an understay record with the rates snapshotted at calc time.
export async function recordUnderstay(stint, { daysServed, reason, cfg, userId }) {
  const daysShort = Math.max(0, cfg.min - daysServed)
  const totalCost = cfg.understayFixed + cfg.understayDaily * daysShort
  const { error } = await supabase.from('understay_records').insert({
    rotation_log_id: stint.id,
    employee_id: stint.employee?.id ?? stint.employee_id,
    days_short: daysShort,
    reason: reason?.trim() || null,
    fixed_cost: cfg.understayFixed,
    daily_rate: cfg.understayDaily,
    total_cost: totalCost,
    created_by: userId ?? null,
  })
  return { error }
}
