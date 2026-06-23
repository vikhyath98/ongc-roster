import { supabase } from './supabase'
import { addDays } from './dates'

// Boarding data layer (SPEC.md §5.4, §6.1).
// Onboard opens a rotation_log stint and mirrors current_installation_id;
// offboard closes the stint and clears the mirror. Both support batches.

const EMP_SELECT =
  'id,emp_id,full_name,designation_id,current_installation_id,' +
  'designation:designations(id,name),installation:installations(id,name,type)'

// Base = active employees with no open stint (current_installation_id null).
export async function listBaseEmployees() {
  return supabase
    .from('employees')
    .select(EMP_SELECT)
    .eq('employment_status', 'active')
    .is('current_installation_id', null)
    .order('full_name')
}

// Currently-offshore stints (open rotation_log rows), with employee + site.
export async function listOffshoreStints() {
  return supabase
    .from('rotation_log')
    .select(
      'id,sign_on_date,expected_rotation_date,installation_id,' +
        'employee:employees(id,emp_id,full_name,designation:designations(id,name,category:categories(name))),' +
        'installation:installations(id,name,type)'
    )
    .is('sign_off_date', null)
    .order('sign_on_date')
}

// Batch onboard: one shared installation + sign-on date for many employees.
// expected_rotation_date defaults to sign-on + maxServiceDays (SPEC §3.1).
export async function batchOnboard(employeeIds, { installationId, signOnDate, maxServiceDays = 70 }, userId) {
  if (!employeeIds.length) return { error: null, count: 0 }
  const expected = addDays(signOnDate, maxServiceDays)
  const stints = employeeIds.map((employee_id) => ({
    employee_id,
    installation_id: installationId,
    sign_on_date: signOnDate,
    expected_rotation_date: expected,
    onboarded_by: userId ?? null,
  }))

  const { error: stintErr } = await supabase.from('rotation_log').insert(stints)
  if (stintErr) return { error: stintErr, count: 0 }

  const { error: mirrorErr } = await supabase
    .from('employees')
    .update({ current_installation_id: installationId })
    .in('id', employeeIds)
  if (mirrorErr) return { error: mirrorErr, count: 0 }

  return { error: null, count: employeeIds.length }
}

// Batch offboard: close the given open stints on a shared sign-off date and
// clear each employee's location mirror.
export async function batchOffboard(stints, signOffDate, userId) {
  if (!stints.length) return { error: null, count: 0 }
  const stintIds = stints.map((s) => s.id)
  const employeeIds = stints.map((s) => s.employee?.id ?? s.employee_id).filter(Boolean)

  const { error: closeErr } = await supabase
    .from('rotation_log')
    .update({ sign_off_date: signOffDate, offboarded_by: userId ?? null })
    .in('id', stintIds)
  if (closeErr) return { error: closeErr, count: 0 }

  const { error: mirrorErr } = await supabase
    .from('employees')
    .update({ current_installation_id: null })
    .in('id', employeeIds)
  if (mirrorErr) return { error: mirrorErr, count: 0 }

  return { error: null, count: stintIds.length }
}
