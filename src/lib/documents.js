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
      'id,name,is_required,applies_to_all,default_validity_days,' +
        'document_type_designations(designation_id)'
    )
    .order('applies_to_all', { ascending: false })
    .order('name')
}

export async function listEmployeeDocuments(employeeId) {
  return supabase
    .from('employee_documents')
    .select('id,employee_id,document_type_id,status,issue_date,expiry_date,verified_by,verified_at')
    .eq('employee_id', employeeId)
}

// All employee documents (lean columns) — used to badge the whole list.
export async function listAllEmployeeDocuments() {
  return supabase
    .from('employee_documents')
    .select('employee_id,document_type_id,status,expiry_date')
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

// Which doc types apply to an employee of the given designation.
export function applicableDocTypes(designationId, docTypes) {
  return docTypes.filter(
    (dt) =>
      dt.applies_to_all ||
      (dt.document_type_designations ?? []).some(
        (m) => m.designation_id === designationId
      )
  )
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

// Suggested expiry from issue date + default validity (e.g. Medical = 365d).
export function suggestedExpiry(issueDate, defaultValidityDays) {
  if (!issueDate || !defaultValidityDays) return ''
  const d = new Date(issueDate + 'T00:00:00')
  d.setDate(d.getDate() + defaultValidityDays)
  return d.toISOString().slice(0, 10)
}
