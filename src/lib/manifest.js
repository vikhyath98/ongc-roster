import { supabase } from './supabase'

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

  const itemRows = items.map((it) => ({
    manifest_request_id: req.id,
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

  return { error: null, id: req.id }
}
