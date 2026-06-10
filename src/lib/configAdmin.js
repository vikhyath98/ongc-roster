import { supabase } from './supabase'

// Configuration writes (SPEC.md §5.8). Every call persists immediately; the
// other screens re-read on navigation, so changes reflect without a reload.

function friendly(error, dupMessage) {
  if (!error) return null
  if (error.code === '23505' && dupMessage) return { ...error, message: dupMessage }
  return error
}

// ----- app_config thresholds/rates -----
export async function updateConfigValue(key, value, userId) {
  const { data, error } = await supabase
    .from('app_config')
    .update({ value: String(value), updated_by: userId ?? null })
    .eq('key', key)
    .select()
    .single()
  return { data, error }
}

// ----- installations -----
export async function createInstallation({ name, type }) {
  const { data, error } = await supabase
    .from('installations')
    .insert({ name: name.trim(), type })
    .select('id,name,type,is_active')
    .single()
  return { data, error: friendly(error, 'An installation with that name already exists.') }
}

export async function updateInstallation(id, fields) {
  const patch = {}
  if (fields.name !== undefined) patch.name = fields.name.trim()
  if (fields.type !== undefined) patch.type = fields.type
  if (fields.is_active !== undefined) patch.is_active = fields.is_active
  const { data, error } = await supabase
    .from('installations')
    .update(patch)
    .eq('id', id)
    .select('id,name,type,is_active')
    .single()
  return { data, error: friendly(error, 'An installation with that name already exists.') }
}

// ----- designations -----
const DESIG_SELECT = 'id,name,category_id,category:categories(id,name)'

export async function createDesignation({ name, category_id }) {
  const { data, error } = await supabase
    .from('designations')
    .insert({ name: name.trim(), category_id })
    .select(DESIG_SELECT)
    .single()
  return { data, error: friendly(error, 'That designation already exists in this category.') }
}

export async function updateDesignation(id, { name, category_id }) {
  const { data, error } = await supabase
    .from('designations')
    .update({ name: name.trim(), category_id })
    .eq('id', id)
    .select(DESIG_SELECT)
    .single()
  return { data, error: friendly(error, 'That designation already exists in this category.') }
}

// ----- document types + the many-to-many designation mapping -----
const DOC_SELECT =
  'id,name,is_required,applies_to_all,default_validity_days,tracks_dates,' +
  'document_type_designations(designation_id)'

export async function createDocumentType(fields) {
  const { data, error } = await supabase
    .from('document_types')
    .insert(normaliseDocType(fields))
    .select(DOC_SELECT)
    .single()
  return { data, error: friendly(error, 'A document type with that name already exists.') }
}

export async function updateDocumentType(id, fields) {
  const { data, error } = await supabase
    .from('document_types')
    .update(normaliseDocType(fields))
    .eq('id', id)
    .select(DOC_SELECT)
    .single()
  return { data, error: friendly(error, 'A document type with that name already exists.') }
}

function normaliseDocType(f) {
  const row = {}
  if (f.name !== undefined) row.name = f.name.trim()
  if (f.is_required !== undefined) row.is_required = f.is_required
  if (f.applies_to_all !== undefined) row.applies_to_all = f.applies_to_all
  if (f.default_validity_days !== undefined)
    row.default_validity_days = f.default_validity_days === '' || f.default_validity_days == null
      ? null
      : Number(f.default_validity_days)
  if (f.tracks_dates !== undefined) row.tracks_dates = f.tracks_dates
  return row
}

// Replace the set of designations linked to a document type (universal docs
// keep no mappings).
export async function setDocTypeDesignations(docTypeId, designationIds) {
  const { error: delErr } = await supabase
    .from('document_type_designations')
    .delete()
    .eq('document_type_id', docTypeId)
  if (delErr) return { error: delErr }
  if (!designationIds || designationIds.length === 0) return { error: null }
  const rows = designationIds.map((designation_id) => ({
    document_type_id: docTypeId,
    designation_id,
  }))
  const { error } = await supabase.from('document_type_designations').insert(rows)
  return { error }
}

// ----- installation requirements -----
export async function listInstallationRequirements() {
  return supabase
    .from('installation_requirements')
    .select('id,installation_id,designation_id,required_count')
}

export async function upsertRequirement(installationId, designationId, count) {
  const { data, error } = await supabase
    .from('installation_requirements')
    .upsert(
      { installation_id: installationId, designation_id: designationId, required_count: count },
      { onConflict: 'installation_id,designation_id' }
    )
    .select()
    .single()
  return { data, error }
}

export async function deleteRequirement(installationId, designationId) {
  const { error } = await supabase
    .from('installation_requirements')
    .delete()
    .eq('installation_id', installationId)
    .eq('designation_id', designationId)
  return { error }
}
