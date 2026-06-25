import { supabase } from './supabase'

// ---------------------------------------------------------------------
// Document types + their designation mappings.
// A doc type applies to an employee if applies_to_all = true OR it is linked
// to the employee's designation via document_type_designations (SPEC.md §6.4).
// ---------------------------------------------------------------------
export async function listDocumentTypes() {
  return supabase
    .from('document_types')
    .select(
      'id,name,is_required,applies_to_all,default_validity_days,tracks_dates,tracks_number,' +
        'document_type_designations(designation_id)'
    )
    .order('applies_to_all', { ascending: false })
    .order('name')
}

export async function listEmployeeDocuments(employeeId) {
  return supabase
    .from('employee_documents')
    .select(
      'id,employee_id,document_type_id,status,issue_date,expiry_date,document_number,date_of_birth,file_path,verified_by,verified_at'
    )
    .eq('employee_id', employeeId)
}

// All employee documents (lean columns) — used to badge the whole list.
export async function listAllEmployeeDocuments() {
  return supabase
    .from('employee_documents')
    .select('employee_id,document_type_id,status,expiry_date,date_of_birth')
}

// Upsert one checklist row. When marking verified, stamp verified_by/at;
// when moving away from verified, clear them.
export async function upsertEmployeeDocument(employeeId, documentTypeId, fields, userId) {
  const verified = fields.status === 'verified'
  const row = {
    employee_id: employeeId,
    document_type_id: documentTypeId,
    status: fields.status,
    issue_date: fields.issue_date || null,
    expiry_date: fields.expiry_date || null,
    document_number: fields.document_number?.trim() || null,
    date_of_birth: fields.date_of_birth || null,
    verified_by: verified ? userId ?? null : null,
    verified_at: verified ? new Date().toISOString() : null,
  }
  return supabase
    .from('employee_documents')
    .upsert(row, { onConflict: 'employee_id,document_type_id' })
    .select()
    .single()
}

// ---------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------

// Does one doc type apply to an employee of the given designation? (§6.4)
export function docTypeApplies(docType, designationId) {
  return (
    docType.applies_to_all ||
    (docType.document_type_designations ?? []).some((m) => m.designation_id === designationId)
  )
}

// Which doc types apply to an employee of the given designation.
export function applicableDocTypes(designationId, docTypes) {
  return docTypes.filter((dt) => docTypeApplies(dt, designationId))
}

const todayISO = () => new Date().toISOString().slice(0, 10)

// Status of one document for an employee.
// Returns: 'verified-current' | 'expired' | 'unverified' | 'missing'
export function docState(docType, empDoc, today = todayISO()) {
  if (!empDoc) return 'missing'
  if (empDoc.status !== 'verified') return 'unverified'
  if (empDoc.expiry_date && empDoc.expiry_date < today) return 'expired'
  return 'verified-current'
}

// Cert-current = every applying REQUIRED doc is verified and unexpired.
// `problems` always names which document fails and why (SPEC.md §6.4).
export function computeCertStatus(designationId, docTypes, empDocs, today = todayISO()) {
  const byType = new Map((empDocs ?? []).map((d) => [d.document_type_id, d]))
  const applicable = applicableDocTypes(designationId, docTypes)
  const problems = []
  for (const dt of applicable) {
    if (!dt.is_required) continue
    const state = docState(dt, byType.get(dt.id), today)
    if (state === 'missing') problems.push({ name: dt.name, reason: 'missing' })
    else if (state === 'unverified') problems.push({ name: dt.name, reason: 'not verified' })
    else if (state === 'expired') problems.push({ name: dt.name, reason: 'expired' })
  }
  return { certCurrent: problems.length === 0, problems, applicableCount: applicable.length }
}

// DOB mismatch (soft flag, SPEC.md §14.9 H). Compares the dates of birth
// recorded on identity documents (tracks_number — Aadhaar/PAN/Passport).
// Needs at least two recorded DOBs to declare a mismatch; a single DOB, or all
// DOBs agreeing, is not a mismatch. Never affects cert-currency or any gate.
export function dobMismatch(empDocs, docTypes) {
  const idTypeIds = new Set((docTypes ?? []).filter((dt) => dt.tracks_number).map((dt) => dt.id))
  const nameById = new Map((docTypes ?? []).map((dt) => [dt.id, dt.name]))
  const recorded = (empDocs ?? [])
    .filter((d) => idTypeIds.has(d.document_type_id) && d.date_of_birth)
    .map((d) => ({ name: nameById.get(d.document_type_id) ?? '—', dob: d.date_of_birth }))
  if (recorded.length < 2) return { mismatch: false }
  if (recorded.every((r) => r.dob === recorded[0].dob)) return { mismatch: false }
  return { mismatch: true, dates: recorded }
}

// Bulk-verify selected document types for selected employees (§6.4).
// For each employee × doc type, only apply where the doc type is applicable to
// that employee's designation; non-applicable pairs are skipped (counted).
// Shared issue/expiry are applied only when provided (existing dates are
// preserved otherwise); date-less docs (Aadhaar/PAN) never receive dates.
// Returns { verified, employeesAffected, skipped, error }.
export async function bulkVerifyDocuments(employees, docTypeIds, { issueDate, expiryDate }, docTypes, userId) {
  const selectedTypes = docTypes.filter((dt) => docTypeIds.includes(dt.id))
  const nowISO = new Date().toISOString()
  // Decide column shape globally so every row in the batch is consistent.
  const includeIssue = Boolean(issueDate)
  const includeExpiry = Boolean(expiryDate)

  const rows = []
  let totalPairs = 0
  for (const emp of employees) {
    for (const dt of selectedTypes) {
      totalPairs++
      if (!docTypeApplies(dt, emp.designation_id)) continue // skip silently
      const dateless = dt.tracks_dates === false
      const row = {
        employee_id: emp.id,
        document_type_id: dt.id,
        status: 'verified',
        verified_by: userId ?? null,
        verified_at: nowISO,
      }
      if (includeIssue) row.issue_date = dateless ? null : issueDate
      if (includeExpiry) row.expiry_date = dateless ? null : expiryDate
      rows.push(row)
    }
  }

  if (rows.length === 0) {
    return { verified: 0, employeesAffected: 0, skipped: totalPairs, error: null }
  }
  const { error } = await supabase
    .from('employee_documents')
    .upsert(rows, { onConflict: 'employee_id,document_type_id' })
  if (error) return { verified: 0, employeesAffected: 0, skipped: 0, error }

  const employeesAffected = new Set(rows.map((r) => r.employee_id)).size
  return { verified: rows.length, employeesAffected, skipped: totalPairs - rows.length, error: null }
}

// Suggested expiry from issue date + default validity (e.g. Medical = 365d).
export function suggestedExpiry(issueDate, defaultValidityDays) {
  if (!issueDate || !defaultValidityDays) return ''
  const d = new Date(issueDate + 'T00:00:00')
  d.setDate(d.getDate() + defaultValidityDays)
  return d.toISOString().slice(0, 10)
}
