import { supabase } from './supabase'
import { onboardEmployee } from './employees'
import { addDays, todayISO } from './dates'

const OUTCOME_LABEL = { listed: 'Listed', boarded: 'Boarded', dropped: 'Dropped', no_show: 'No-show' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso) => {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`
}

// Manifest → RFM → boarding pipeline (migration 0006). Manifest requests are
// what SKFS asks ONGC to mobilise; each line item names an incoming relief
// employee and (optionally) the offshore employee they relieve, which spawns a
// replacement_pairings row tracked across retries.

// ---------------------------------------------------------------------
// Manifest requests
// ---------------------------------------------------------------------
export async function listManifestRequests() {
  return supabase
    .from('manifest_requests')
    .select(
      'id,request_date,status,notes,created_at,' +
        'installation:installations(id,name,type),' +
        'items:manifest_request_items(id,employee_id,replacing_employee_id,is_emergency_exception)'
    )
    .order('request_date', { ascending: false })
    .order('created_at', { ascending: false })
}

export async function updateManifestRequestStatus(id, status) {
  return supabase
    .from('manifest_requests')
    .update({ status })
    .eq('id', id)
    .select('id,status')
    .single()
}

// Most recent failed pairing (dropped / no_show) for an outgoing employee, so
// a fresh attempt can chain onto it via retry_of_pairing_id. null if none.
export async function latestFailedPairingId(outgoingEmployeeId) {
  const { data, error } = await supabase
    .from('replacement_pairings')
    .select('id')
    .eq('outgoing_employee_id', outgoingEmployeeId)
    .in('status', ['dropped', 'no_show'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { id: null, error }
  return { id: data?.[0]?.id ?? null, error: null }
}

// Create a request, its line items, and a 'pending' pairing for every item
// that names an outgoing (replacing) employee. Each such pairing chains onto
// that employee's most recent prior failed attempt, if any.
//
// items: [{ employeeId, replacingEmployeeId|null, reason|null,
//           isEmergencyException, exceptionReason|null }]
// Insert line items for a request, plus a 'pending' pairing for each item that
// names an outgoing employee (chained onto that employee's most recent prior
// failed attempt). Shared by request creation and add-to-existing.
async function insertItemsAndPairings(requestId, items) {
  const itemRows = items.map((it) => ({
    manifest_request_id: requestId,
    employee_id: it.employeeId,
    replacing_employee_id: it.replacingEmployeeId || null,
    reason: it.reason || null,
    is_emergency_exception: Boolean(it.isEmergencyException),
    exception_reason: it.exceptionReason || null,
  }))
  const { data: insertedItems, error: itemErr } = await supabase
    .from('manifest_request_items')
    .insert(itemRows)
    .select('id,employee_id,replacing_employee_id')
  if (itemErr) return { error: itemErr }

  const pairingRows = []
  for (const it of insertedItems) {
    if (!it.replacing_employee_id) continue
    const { id: retryOf } = await latestFailedPairingId(it.replacing_employee_id)
    pairingRows.push({
      manifest_request_item_id: it.id,
      outgoing_employee_id: it.replacing_employee_id,
      incoming_employee_id: it.employee_id,
      retry_of_pairing_id: retryOf,
      status: 'pending',
    })
  }
  if (pairingRows.length > 0) {
    const { error: pErr } = await supabase.from('replacement_pairings').insert(pairingRows)
    if (pErr) return { error: pErr }
  }
  return { error: null }
}

export async function createManifestRequest(
  { installationId, requestDate, notes, requestedBy },
  items
) {
  const { data: req, error: reqErr } = await supabase
    .from('manifest_requests')
    .insert({
      installation_id: installationId,
      request_date: requestDate,
      notes: notes || null,
      requested_by: requestedBy ?? null,
      status: 'sent',
    })
    .select('id')
    .single()
  if (reqErr) return { error: reqErr }

  const { error } = await insertItemsAndPairings(req.id, items)
  return { error, id: req.id }
}

// Add more line items (with the same pairing logic) to an existing request.
export async function addManifestItems(requestId, items) {
  return insertItemsAndPairings(requestId, items)
}

// Full detail of one request: fields, any logged RFMs, and every line item
// with its incoming/outgoing employees and current pairing status (+ the RFM
// number it was listed on, if any).
export async function getManifestRequest(id) {
  return supabase
    .from('manifest_requests')
    .select(
      'id,request_date,status,notes,installation_id,' +
        'installation:installations(id,name,type),' +
        'rfms:rfms(id,rfm_number),' +
        'items:manifest_request_items(' +
        'id,reason,is_emergency_exception,exception_reason,employee_id,replacing_employee_id,' +
        'employee:employees!manifest_request_items_employee_id_fkey(id,full_name,emp_id,designation:designations(id,name)),' +
        'replacing:employees!manifest_request_items_replacing_employee_id_fkey(id,full_name,emp_id,designation:designations(id,name)),' +
        'pairings:replacement_pairings(id,status,rfm_line_item:rfm_line_items(id,rfm:rfms(id,rfm_number)))' +
        ')'
    )
    .eq('id', id)
    .single()
}

// Cancel a pairing — only allowed while still 'pending' (never pulled onto an
// RFM). Keeps the row; just flips the status.
export async function cancelPairing(pairingId) {
  const { data, error } = await supabase
    .from('replacement_pairings')
    .select('status')
    .eq('id', pairingId)
    .single()
  if (error) return { error }
  if (data.status !== 'pending') {
    return { error: { message: 'Only a pending pairing can be cancelled.' } }
  }
  return supabase.from('replacement_pairings').update({ status: 'cancelled' }).eq('id', pairingId)
}

// Edit request fields. Installation/date should be locked by the caller once
// an RFM exists; notes are always editable.
export async function updateManifestRequest(id, { installationId, requestDate, notes }) {
  const patch = {}
  if (installationId !== undefined) patch.installation_id = installationId
  if (requestDate !== undefined) patch.request_date = requestDate
  if (notes !== undefined) patch.notes = notes || null
  return supabase.from('manifest_requests').update(patch).eq('id', id).select('id').single()
}

// Line items of a request (used to pre-fill an RFM from a request).
export async function listRequestItems(manifestRequestId) {
  return supabase
    .from('manifest_request_items')
    .select('id,employee_id,employee:employees!manifest_request_items_employee_id_fkey(id,full_name,emp_id)')
    .eq('manifest_request_id', manifestRequestId)
}

// ---------------------------------------------------------------------
// RFMs + line items
// ---------------------------------------------------------------------
export async function listRfms() {
  return supabase
    .from('rfms')
    .select(
      'id,rfm_number,sortie_date,mode_of_journey,manifest_request_id,' +
        'installation:installations(id,name,type),' +
        'line_items:rfm_line_items(id,outcome)'
    )
    .order('sortie_date', { ascending: false })
    .order('created_at', { ascending: false })
}

export async function getRfm(id) {
  return supabase
    .from('rfms')
    .select(
      'id,rfm_number,sortie_date,scheduled_dep_time,scheduled_report_time,mode_of_journey,' +
        'notes,manifest_request_id,installation_id,' +
        'installation:installations(id,name,type),' +
        'line_items:rfm_line_items(id,employee_id,vendor_code,outcome,outcome_reason,outcome_recorded_at,rotation_log_id,' +
        'employee:employees(id,full_name,emp_id,designation:designations(id,name)))'
    )
    .eq('id', id)
    .single()
}

// Log an RFM with its line items. If linked to a request, every line-item
// employee that still has a 'pending' pairing from that request is moved to
// 'rfm_listed' with rfm_line_item_id set.
//
// lineItems: [{ employeeId, vendorCode|null }]
export async function createRfm(
  {
    rfmNumber,
    installationId,
    sortieDate,
    scheduledDepTime,
    scheduledReportTime,
    modeOfJourney,
    manifestRequestId,
    notes,
  },
  lineItems
) {
  const { data: rfm, error: rfmErr } = await supabase
    .from('rfms')
    .insert({
      rfm_number: rfmNumber.trim(),
      installation_id: installationId,
      sortie_date: sortieDate,
      scheduled_dep_time: scheduledDepTime || null,
      scheduled_report_time: scheduledReportTime || null,
      mode_of_journey: modeOfJourney,
      manifest_request_id: manifestRequestId || null,
      notes: notes || null,
    })
    .select('id')
    .single()
  if (rfmErr) {
    const message =
      rfmErr.code === '23505' ? 'An RFM with that number already exists.' : rfmErr.message
    return { error: { ...rfmErr, message } }
  }

  const rows = lineItems.map((li) => ({
    rfm_id: rfm.id,
    employee_id: li.employeeId,
    vendor_code: li.vendorCode || null,
  }))
  const { data: insertedLines, error: liErr } = await supabase
    .from('rfm_line_items')
    .insert(rows)
    .select('id,employee_id')
  if (liErr) return { error: liErr }

  // Link this RFM's lines to the request's pending pairings.
  if (manifestRequestId) {
    const { data: pendingPairings } = await supabase
      .from('replacement_pairings')
      .select('id,incoming_employee_id,manifest_request_items!inner(manifest_request_id)')
      .eq('status', 'pending')
      .eq('manifest_request_items.manifest_request_id', manifestRequestId)

    for (const p of pendingPairings ?? []) {
      const line = insertedLines.find((l) => l.employee_id === p.incoming_employee_id)
      if (!line) continue
      await supabase
        .from('replacement_pairings')
        .update({ status: 'rfm_listed', rfm_line_item_id: line.id })
        .eq('id', p.id)
    }
  }

  return { error: null, id: rfm.id }
}

// Manual onboard (exception) — board someone outside the formal manifest/RFM
// flow. Onboards as normal, flags the rotation_log row as a manual exception
// with its reason, and (optionally) opens a 'boarded' pairing for the relieved
// employee. Returns { error }.
export async function manualOnboard({
  employeeId,
  installationId,
  signOnDate,
  reason,
  relievingEmployeeId,
  userId,
  maxServiceDays = 70,
  reliefGraceDays = 1,
}) {
  const { data: log, error: onErr } = await onboardEmployee(
    employeeId,
    {
      installationId,
      signOnDate,
      expectedRotationDate: addDays(signOnDate, maxServiceDays),
    },
    userId
  )
  if (onErr) return { error: onErr }

  const { error: flagErr } = await supabase
    .from('rotation_log')
    .update({ is_manual_exception: true, manual_exception_reason: reason?.trim() || null })
    .eq('id', log.id)
  if (flagErr) return { error: flagErr }

  if (relievingEmployeeId) {
    const { error: pErr } = await supabase.from('replacement_pairings').insert({
      manifest_request_item_id: null,
      outgoing_employee_id: relievingEmployeeId,
      incoming_employee_id: employeeId,
      status: 'boarded',
      relief_deadline: addDays(signOnDate, reliefGraceDays),
    })
    if (pErr) return { error: pErr }
  }

  return { error: null }
}

// Correct a mistaken outcome (only allowed on the recording day; the UI
// enforces that window). Reverses the OLD outcome's side effects, then applies
// the NEW one via recordRfmOutcome. Correcting away from Boarded is
// destructive: it deletes the rotation_log row created at boarding and returns
// the employee to base.
export async function correctRfmOutcome(line, newOutcome, opts = {}) {
  if (line.outcome === 'boarded') {
    if (line.rotation_log_id) {
      await supabase.from('rotation_log').delete().eq('id', line.rotation_log_id)
      await supabase
        .from('employees')
        .update({ current_installation_id: null })
        .eq('id', line.employee_id)
    }
    await supabase.from('rfm_line_items').update({ rotation_log_id: null }).eq('id', line.id)
    const pairing = await pairingForLine(line.id)
    if (pairing) {
      await supabase
        .from('replacement_pairings')
        .update({ relief_deadline: null })
        .eq('id', pairing.id)
    }
  } else if (line.outcome === 'no_show') {
    // Undo the no-show counter bump (prior confirmed state can't be restored).
    const { data: emp } = await supabase
      .from('employees')
      .select('no_show_count')
      .eq('id', line.employee_id)
      .single()
    await supabase
      .from('employees')
      .update({ no_show_count: Math.max(0, (emp?.no_show_count ?? 0) - 1) })
      .eq('id', line.employee_id)
  }

  // Preserve the original reason in the audit trail rather than overwriting it.
  // Repeated corrections nest, so nothing is ever lost.
  const orig = line.outcome_reason?.trim()
  const origNote = orig
    ? `[Original (${OUTCOME_LABEL[line.outcome] ?? line.outcome}): ${orig}]`
    : `[Original: ${OUTCOME_LABEL[line.outcome] ?? line.outcome}, no reason given]`
  const changeNote = `[Corrected ${shortDate(todayISO())} → ${
    OUTCOME_LABEL[newOutcome] ?? newOutcome
  }: ${opts.reason?.trim() || 'no reason given'}]`
  const composedReason = `${origNote} ${changeNote}`

  return recordRfmOutcome({ ...line, rotation_log_id: null }, newOutcome, {
    ...opts,
    reason: composedReason,
  })
}

// The pairing currently tied to a given RFM line item, if any.
async function pairingForLine(lineItemId) {
  const { data } = await supabase
    .from('replacement_pairings')
    .select('id,outgoing_employee_id')
    .eq('rfm_line_item_id', lineItemId)
    .limit(1)
  return data?.[0] ?? null
}

// Record an outcome for one RFM line item: Boarded / Dropped / No-show.
// `rfm` must carry { installation_id, sortie_date }. Returns { error }.
export async function recordRfmOutcome(
  lineItem,
  outcome,
  { reason, userId, rfm, maxServiceDays = 70, reliefGraceDays = 1 } = {}
) {
  const nowISO = new Date().toISOString()
  const patch = {
    outcome,
    outcome_reason: reason?.trim() || null,
    outcome_recorded_at: nowISO,
    outcome_recorded_by: userId ?? null,
  }

  if (outcome === 'boarded') {
    const { data: log, error: onErr } = await onboardEmployee(
      lineItem.employee_id,
      {
        installationId: rfm.installation_id,
        signOnDate: rfm.sortie_date,
        expectedRotationDate: addDays(rfm.sortie_date, maxServiceDays),
      },
      userId
    )
    if (onErr) return { error: onErr }
    patch.rotation_log_id = log?.id ?? null
  }

  const { error: liErr } = await supabase.from('rfm_line_items').update(patch).eq('id', lineItem.id)
  if (liErr) return { error: liErr }

  const pairing = await pairingForLine(lineItem.id)

  if (outcome === 'boarded' && pairing) {
    const { error } = await supabase
      .from('replacement_pairings')
      .update({
        status: 'boarded',
        relief_deadline: addDays(rfm.sortie_date, reliefGraceDays),
      })
      .eq('id', pairing.id)
    if (error) return { error }
  } else if (outcome === 'dropped' && pairing) {
    const { error } = await supabase
      .from('replacement_pairings')
      .update({ status: 'dropped' })
      .eq('id', pairing.id)
    if (error) return { error }
  } else if (outcome === 'no_show') {
    if (pairing) {
      const { error } = await supabase
        .from('replacement_pairings')
        .update({ status: 'no_show' })
        .eq('id', pairing.id)
      if (error) return { error }
    }
    // A proven-unreliable confirmation is revoked, and the no-show is counted.
    await supabase
      .from('availability')
      .upsert(
        { employee_id: lineItem.employee_id, confirmed: false, updated_by: userId ?? null },
        { onConflict: 'employee_id' }
      )
    const { data: emp } = await supabase
      .from('employees')
      .select('no_show_count')
      .eq('id', lineItem.employee_id)
      .single()
    await supabase
      .from('employees')
      .update({ no_show_count: (emp?.no_show_count ?? 0) + 1 })
      .eq('id', lineItem.employee_id)
  }

  return { error: null }
}
