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

// Onboard an employee: open a rotation_log stint and mirror the location onto
// the employee row (SPEC.md §5.4, §6.1). Used both when entering an
// already-offshore employee and (later) by the Boarding flow.
export async function onboardEmployee(
  employeeId,
  { installationId, signOnDate, expectedRotationDate },
  userId
) {
  const { error: logErr } = await supabase.from('rotation_log').insert({
    employee_id: employeeId,
    installation_id: installationId,
    sign_on_date: signOnDate,
    expected_rotation_date: expectedRotationDate || null,
    onboarded_by: userId ?? null,
  })
  if (logErr) return { error: logErr }

  const { error: mirrorErr } = await supabase
    .from('employees')
    .update({ current_installation_id: installationId })
    .eq('id', employeeId)
  return { error: mirrorErr }
}

// All rotation stints for an employee (history), most recent first.
export async function listEmployeeRotations(employeeId) {
  return supabase
    .from('rotation_log')
    .select(
      'id,sign_on_date,sign_off_date,expected_rotation_date,installation:installations(name,type)'
    )
    .eq('employee_id', employeeId)
    .order('sign_on_date', { ascending: false })
}

// Soft delete / reactivate: the standard way to retire someone while keeping
// all history. Inactive staff are filtered out of operational lists.
export async function setEmploymentStatus(id, status) {
  const { data, error } = await supabase
    .from('employees')
    .update({ employment_status: status })
    .eq('id', id)
    .select(SELECT)
    .single()
  return { data, error }
}

// How many rotation stints an employee has (ever). Used to decide whether a
// hard delete is allowed.
export async function employeeRotationCount(employeeId) {
  const { count, error } = await supabase
    .from('rotation_log')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
  return { count: count ?? 0, error }
}

// Hard delete — ONLY permitted for employees with NO rotation history
// (data-entry mistakes / test rows). Employees with history must be
// deactivated instead; this function refuses them as a safety net even if the
// UI hides the button. Documents/availability/call_log cascade away.
export async function deleteEmployee(employeeId) {
  const { count, error: countErr } = await employeeRotationCount(employeeId)
  if (countErr) return { error: countErr }
  if (count > 0) {
    return {
      error: {
        message:
          'This employee has rotation history and cannot be deleted. Set them Inactive instead.',
      },
    }
  }
  const { error } = await supabase.from('employees').delete().eq('id', employeeId)
  return { error }
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
