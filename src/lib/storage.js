import { supabase } from './supabase'

// File storage for identity photos + document scans (SPEC.md §17.P, Workstream P).
// Everything lives in the 'employee-documents' bucket. Callers store only the
// object PATH on the row; the browser only ever sees short-lived signed URLs.

const BUCKET = 'employee-documents'

// Upload (or replace) an employee's identity photo, then record its path on the
// employee row. upsert:true so replacing doesn't orphan the old object.
export async function uploadEmployeePhoto(employeeId, file) {
  const path = `${employeeId}/photo/${file.name}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true })
  if (upErr) return { path: null, error: upErr }

  const { error } = await supabase.from('employees').update({ photo_path: path }).eq('id', employeeId)
  return { path, error }
}

// Upload (or replace) the scan for one document, then record its path on the
// employee_documents row.
export async function uploadDocumentScan(employeeId, employeeDocumentId, documentTypeId, file) {
  const path = `${employeeId}/docs/${documentTypeId}/${file.name}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true })
  if (upErr) return { path: null, error: upErr }

  const { error } = await supabase
    .from('employee_documents')
    .update({ file_path: path })
    .eq('id', employeeDocumentId)
  return { path, error }
}

// A short-lived signed URL for a stored object, or null on error/no path.
export async function getSignedUrl(path, expiresInSeconds = 3600) {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error) return null
  return data?.signedUrl ?? null
}

// Remove an object from the bucket.
export async function deleteFile(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  return { error }
}
