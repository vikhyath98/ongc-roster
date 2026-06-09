import { supabase } from './supabase'

// Columns we always pull for an employee, with the joined designation and
// (if any) current installation for display.
const SELECT =
  'id,emp_id,full_name,phone,employment_status,notes,designation_id,current_installation_id,' +
  'designation:designations(id,name,category:categories(id,name)),' +
  'installation:installations(id,name,type)'

export async function listEmployees() {
  return supabase.from('employees').select(SELECT).order('full_name')
}

export async function getEmployee(id) {
  return supabase.from('employees').select(SELECT).eq('id', id).maybeSingle()
}

// Create. emp_id uniqueness is enforced by the DB; we surface a friendly
// message on the unique-violation error code (23505).
export async function createEmployee(input) {
  const { data, error } = await supabase
    .from('employees')
    .insert(toRow(input))
    .select(SELECT)
    .single()
  return { data, error: friendlyError(error) }
}

export async function updateEmployee(id, input) {
  const { data, error } = await supabase
    .from('employees')
    .update(toRow(input))
    .eq('id', id)
    .select(SELECT)
    .single()
  return { data, error: friendlyError(error) }
}

function toRow(input) {
  return {
    // Store emp_id uppercased so case variants can't create duplicates.
    emp_id: input.emp_id?.trim().toUpperCase(),
    full_name: input.full_name?.trim(),
    designation_id: input.designation_id || null,
    phone: input.phone?.trim() || null,
    employment_status: input.employment_status || 'active',
    notes: input.notes?.trim() || null,
  }
}

function friendlyError(error) {
  if (!error) return null
  if (error.code === '23505') {
    return { ...error, message: 'That Employee ID already exists.' }
  }
  return error
}
