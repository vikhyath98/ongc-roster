import { supabase } from './supabase'
import { addDays, daysBetween, daysInclusive, todayISO } from './dates'
import { listEmployees } from './employees'
import { computeCertStatus, listDocumentTypes, listAllEmployeeDocuments, dobMismatch } from './documents'
import { isConfirmedLive, listAvailability } from './reserve'

// SheetJS is large and only needed for import/export/template, so load it on
// demand (keeps it out of the initial bundle — matters for the mobile PWA).
const loadXLSX = () => import('xlsx')

// Bulk employee import/export from .xlsx (build answers §10, extended).
// The template captures current details, current location, and up to three
// completed rotation stints (oldest → most recent). Valid rows create the
// employee plus a rotation_log row per stint, exactly as onboardEmployee()
// does for the current location. Invalid rows are surfaced in a preview —
// never silently skipped.

// Canonical import columns, in template/export order.
const IMPORT_COLUMNS = [
  'emp_id',
  'full_name',
  'designation',
  'phone',
  'employment_status',
  'base_location_type',
  'recall_lead_time_days',
  'notes',
  'current_location',
  'current_sign_on',
  'stint_1_installation',
  'stint_1_sign_on',
  'stint_1_sign_off',
  'stint_2_installation',
  'stint_2_sign_on',
  'stint_2_sign_off',
  'stint_3_installation',
  'stint_3_sign_on',
  'stint_3_sign_off',
]

// Read-only info columns appended to an export. Ignored on import (their
// headers carry a [Read Only] tag that matches no synonym).
const READONLY_COLUMNS = ['cert_status', 'cert_issues', 'days_since_signoff', 'confirmation_status', 'dob_mismatch']
const readonlyHeader = (c) => `${c} [Read Only]`

// Accepted header spellings -> canonical field.
const HEADER_SYNONYMS = {
  emp_id: ['emp_id', 'empid', 'employee id', 'employeeid', 'id', 'employee_id'],
  full_name: ['full_name', 'fullname', 'name', 'employee name', 'employeename'],
  designation: ['designation', 'role', 'post'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number', 'phoneno'],
  employment_status: ['employment_status', 'employment status', 'status'],
  base_location_type: ['base_location_type', 'base location type', 'location type', 'base location'],
  recall_lead_time_days: ['recall_lead_time_days', 'recall lead time', 'recall days', 'recall lead time days', 'recall lead time (days)'],
  notes: ['notes', 'note', 'remark', 'remarks'],
  current_location: ['current_location', 'current location', 'location', 'installation', 'posting', 'site', 'platform rig'],
  current_sign_on: ['current_sign_on', 'current sign on', 'sign_on_date', 'sign on date', 'signon date', 'sign on', 'onboard date', 'boarding date', 'date of boarding'],
  stint_1_installation: ['stint_1_installation', 'stint 1 installation'],
  stint_1_sign_on: ['stint_1_sign_on', 'stint 1 sign on'],
  stint_1_sign_off: ['stint_1_sign_off', 'stint 1 sign off'],
  stint_2_installation: ['stint_2_installation', 'stint 2 installation'],
  stint_2_sign_on: ['stint_2_sign_on', 'stint 2 sign on'],
  stint_2_sign_off: ['stint_2_sign_off', 'stint 2 sign off'],
  stint_3_installation: ['stint_3_installation', 'stint 3 installation'],
  stint_3_sign_on: ['stint_3_sign_on', 'stint 3 sign on'],
  stint_3_sign_off: ['stint_3_sign_off', 'stint 3 sign off'],
}

const normalize = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[–—\s._-]+/g, ' ')
    .trim()

// Pre-normalise the synonyms so matching is case-insensitive, whitespace-
// trimmed, and separator-agnostic ("emp_id", "Emp ID", "empid" all match).
const NORMALIZED_SYNONYMS = Object.entries(HEADER_SYNONYMS).reduce((acc, [field, syns]) => {
  for (const s of syns) acc[normalize(s)] = field
  return acc
}, {})

function buildHeaderMap(rawKeys) {
  const map = {}
  for (const key of rawKeys) {
    const field = NORMALIZED_SYNONYMS[normalize(key)]
    if (field && !map[field]) map[field] = key
  }
  return map
}

// Normalise a date cell to ISO 'YYYY-MM-DD'.
// Returns '' for blank, null for an unparseable value, else the ISO string.
function toISODate(value) {
  if (value === '' || value == null) return ''
  if (value instanceof Date && !isNaN(value)) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s // already ISO
  const d = new Date(s)
  if (isNaN(d)) return null
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

// Parse the first worksheet into canonical rows. Throws on unreadable files.
export async function parseWorkbook(file) {
  const XLSX = await loadXLSX()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file has no worksheets.')
  const ws = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
  if (json.length === 0) throw new Error('No data rows found below the header.')

  const headerMap = buildHeaderMap(Object.keys(json[0]))
  const missing = ['emp_id', 'full_name', 'designation'].filter((f) => !headerMap[f])
  if (missing.length) {
    throw new Error(
      `Missing required column(s): ${missing.join(', ')}. ` +
        'Expected headers like emp_id, full_name, designation, and optionally ' +
        'current_location, current_sign_on, stint_1_installation, etc.'
    )
  }

  const pick = (row, field) => (headerMap[field] ? String(row[headerMap[field]] ?? '').trim() : '')
  return json.map((row) => {
    const out = {}
    for (const field of IMPORT_COLUMNS) out[field] = pick(row, field)
    return out
  })
}

// Read the three raw stint cells for stint n (1-based) from a parsed row.
function rawStint(raw, n) {
  return {
    n,
    installation: raw[`stint_${n}_installation`],
    sign_on: raw[`stint_${n}_sign_on`],
    sign_off: raw[`stint_${n}_sign_off`],
  }
}
const anyFilled = (s) => Boolean(s.installation || s.sign_on || s.sign_off)
const allFilled = (s) => Boolean(s.installation && s.sign_on && s.sign_off)

// Validate parsed rows against designations, installations and existing
// emp_ids. Resolves current location + rotation history into onboarding data.
// Returns rows with { rowNumber, data, errors, warnings, valid }.
export function validateRows(rows, designations, installations, existingEmpIds, today = todayISO()) {
  const byDesignation = new Map(designations.map((d) => [normalize(d.name), d]))
  const byInstallation = new Map((installations ?? []).map((i) => [normalize(i.name), i]))
  const existing = new Set((existingEmpIds ?? []).map((id) => String(id).toUpperCase()))
  const seenInFile = new Map() // upper emp_id -> first row number

  return rows.map((raw, i) => {
    const rowNumber = i + 2 // +1 header, +1 to 1-base
    const errors = []
    const warnings = []
    // Standardise emp_id to uppercase up front (SPEC: case-insensitive ID).
    const data = { ...raw, emp_id: raw.emp_id.toUpperCase() }

    if (!data.emp_id) errors.push('Employee ID is blank')
    if (!data.full_name) errors.push('Name is blank')

    let designation_id = null
    if (!data.designation) {
      errors.push('Designation is blank')
    } else {
      const match = byDesignation.get(normalize(data.designation))
      if (!match) errors.push(`Unknown designation "${data.designation}"`)
      else designation_id = match.id
    }

    if (data.emp_id) {
      const key = data.emp_id
      if (existing.has(key)) errors.push(`Employee ID "${data.emp_id}" already exists`)
      if (seenInFile.has(key)) {
        errors.push(`Duplicate of row ${seenInFile.get(key)} in this file`)
      } else {
        seenInFile.set(key, rowNumber)
      }
    }

    // employment_status: optional; must be active/inactive; defaults active.
    let employment_status = 'active'
    if (data.employment_status) {
      const v = data.employment_status.toLowerCase()
      if (v === 'active' || v === 'inactive') employment_status = v
      else errors.push('employment_status must be "active" or "inactive".')
    }

    // base_location_type: optional; guesthouse/hometown (the "Out of town"
    // label maps to hometown). Blank/unknown stays null. (migration 0006 enum)
    let base_location_type = null
    if (data.base_location_type) {
      const v = normalize(data.base_location_type)
      if (v === 'guesthouse') base_location_type = 'guesthouse'
      else if (v === 'hometown' || v === 'out of town') base_location_type = 'hometown'
      else errors.push('base_location_type must be "guesthouse" or "hometown" (or blank).')
    }

    // recall_lead_time_days: optional; non-negative whole number or blank.
    let recall_lead_time_days = null
    if (data.recall_lead_time_days) {
      const n = Number(data.recall_lead_time_days)
      if (!Number.isInteger(n) || n < 0) {
        errors.push('recall_lead_time_days must be a whole number (0 or more), or blank.')
      } else {
        recall_lead_time_days = n
      }
    }

    // ----- Rotation history (up to 3 completed stints, oldest -> most recent) -----
    const rawStints = [1, 2, 3].map((n) => rawStint(data, n))

    // Rule 1: all-or-nothing per stint.
    for (const s of rawStints) {
      if (anyFilled(s) && !allFilled(s)) {
        errors.push(
          `Stint ${s.n} is incomplete — provide installation, sign_on, and sign_off together or leave all three blank.`
        )
      }
    }
    // Rule 2: no gaps in sequence.
    const present = rawStints.map(anyFilled)
    for (let n = 2; n <= 3; n++) {
      if (present[n - 1] && !present[n - 2]) {
        errors.push(
          `Stint ${n} provided but Stint ${n - 1} is empty — fill stints in order from oldest to most recent.`
        )
      }
    }

    // Resolve the fully-filled stints (installation + dates) with per-stint rules.
    const stints = []
    for (const s of rawStints) {
      if (!allFilled(s)) continue
      const inst = byInstallation.get(normalize(s.installation))
      if (!inst) {
        errors.push(
          `Installation '${s.installation}' not recognised — check spelling against the installation list.`
        )
      }
      const on = toISODate(s.sign_on)
      const off = toISODate(s.sign_off)
      if (on === null) errors.push(`Stint ${s.n} sign_on "${s.sign_on}" is not a valid date (use YYYY-MM-DD).`)
      if (off === null) errors.push(`Stint ${s.n} sign_off "${s.sign_off}" is not a valid date (use YYYY-MM-DD).`)
      if (on && off) {
        // Rule 4: sign_off after sign_on within the same stint.
        if (off <= on) errors.push(`Stint ${s.n} sign_off is before or equal to sign_on.`)
        // Rule 5: completed stints must have a past sign_off date.
        if (off >= today) {
          errors.push(
            `Stint ${s.n} sign_off is in the future — completed stints must have a past sign_off date.`
          )
        }
        // Rule 7: days-served sanity warning (does not block import).
        const served = daysInclusive(on, off)
        if (served < 10 || served > 150) {
          warnings.push(`Stint ${s.n}: ${served} days served — please verify.`)
        }
      }
      stints.push({
        n: s.n,
        installation_id: inst?.id ?? null,
        installation_name: inst?.name ?? null,
        sign_on: on || null,
        sign_off: off || null,
      })
    }

    // Rule 3: chronological order across consecutive stints.
    for (let i2 = 0; i2 + 1 < stints.length; i2++) {
      const a = stints[i2]
      const b = stints[i2 + 1]
      if (a.sign_off && b.sign_on && a.sign_off >= b.sign_on) {
        errors.push('Stint dates overlap or are out of order.')
        break
      }
    }

    // ----- Current location (rule 8) -----
    let current = null
    const locFilled = Boolean(data.current_location)
    const onFilled = Boolean(data.current_sign_on)
    if (locFilled !== onFilled) {
      errors.push('current_location and current_sign_on must be provided together (both or neither).')
    } else if (locFilled && onFilled) {
      const inst = byInstallation.get(normalize(data.current_location))
      if (!inst) {
        errors.push(
          `Installation '${data.current_location}' not recognised — check spelling against the installation list.`
        )
      }
      const onISO = toISODate(data.current_sign_on)
      if (onISO === null) {
        errors.push(`current_sign_on "${data.current_sign_on}" is not a valid date (use YYYY-MM-DD).`)
      } else {
        if (onISO >= today) errors.push('current_sign_on must be before today.')
        const lastStint = stints[stints.length - 1]
        if (lastStint?.sign_off && onISO <= lastStint.sign_off) {
          errors.push('current_sign_on must be after the most recent stint sign_off.')
        }
      }
      current = {
        installation_id: inst?.id ?? null,
        installation_name: inst?.name ?? null,
        sign_on: onISO || null,
      }
    }

    return {
      rowNumber,
      data: {
        ...data,
        designation_id,
        employment_status,
        base_location_type,
        recall_lead_time_days,
        stints,
        current,
      },
      errors,
      warnings,
      valid: errors.length === 0,
    }
  })
}

// Insert valid rows, then create rotation_log rows for each resolved stint and
// the current location. Returns { inserted, historyStints, onboarded, error }.
export async function importValidRows(validated, { maxServiceDays = 70, userId } = {}) {
  const validRows = validated.filter((r) => r.valid)
  if (validRows.length === 0) return { inserted: 0, historyStints: 0, onboarded: 0, error: null }

  const payload = validRows.map((r) => ({
    emp_id: r.data.emp_id.toUpperCase(),
    full_name: r.data.full_name,
    designation_id: r.data.designation_id,
    phone: r.data.phone || null,
    notes: r.data.notes || null,
    employment_status: r.data.employment_status,
    base_location_type: r.data.base_location_type,
    recall_lead_time_days: r.data.recall_lead_time_days,
  }))

  const { data: inserted, error } = await supabase
    .from('employees')
    .insert(payload)
    .select('id,emp_id')
  if (error) {
    const message =
      error.code === '23505'
        ? 'A duplicate Employee ID slipped through (added since preview). Re-upload to refresh.'
        : error.message
    return { inserted: 0, historyStints: 0, onboarded: 0, error: { ...error, message } }
  }

  const idByEmpId = new Map(inserted.map((e) => [e.emp_id.toUpperCase(), e.id]))

  // Build every rotation_log row: completed history stints (sign_off set) plus
  // any current open stint (sign_off null). Manager owns both ends.
  const rotationRows = []
  let historyStints = 0
  let onboarded = 0
  const currentByInstall = new Map() // installation_id -> [employeeId] for the location mirror
  for (const r of validRows) {
    const empId = idByEmpId.get(r.data.emp_id.toUpperCase())
    for (const s of r.data.stints) {
      rotationRows.push({
        employee_id: empId,
        installation_id: s.installation_id,
        sign_on_date: s.sign_on,
        sign_off_date: s.sign_off,
        onboarded_by: userId ?? null,
        offboarded_by: userId ?? null,
      })
      historyStints++
    }
    if (r.data.current) {
      rotationRows.push({
        employee_id: empId,
        installation_id: r.data.current.installation_id,
        sign_on_date: r.data.current.sign_on,
        expected_rotation_date: addDays(r.data.current.sign_on, maxServiceDays),
        onboarded_by: userId ?? null,
      })
      onboarded++
      if (!currentByInstall.has(r.data.current.installation_id)) {
        currentByInstall.set(r.data.current.installation_id, [])
      }
      currentByInstall.get(r.data.current.installation_id).push(empId)
    }
  }

  if (rotationRows.length > 0) {
    const { error: stintErr } = await supabase.from('rotation_log').insert(rotationRows)
    if (stintErr) {
      return {
        inserted: inserted.length,
        historyStints: 0,
        onboarded: 0,
        error: { message: `Employees imported, but writing rotation history failed: ${stintErr.message}` },
      }
    }
  }

  // Mirror current_installation_id for anyone with an open stint.
  for (const [installationId, ids] of currentByInstall) {
    const { error: mirrorErr } = await supabase
      .from('employees')
      .update({ current_installation_id: installationId })
      .in('id', ids)
    if (mirrorErr) {
      return {
        inserted: inserted.length,
        historyStints,
        onboarded: 0,
        error: { message: `Employees and history imported, but location update failed: ${mirrorErr.message}` },
      }
    }
  }

  return { inserted: inserted.length, historyStints, onboarded, error: null }
}

// ---------------------------------------------------------------------
// Export — every import column plus read-only info columns. The history
// columns hold the 3 most recent completed stints (oldest first), so an
// exported file is re-importable using the same column structure.
// ---------------------------------------------------------------------
export async function exportEmployees() {
  const XLSX = await loadXLSX()
  const today = todayISO()

  const [empRes, rotRes, dtRes, docsRes, avRes] = await Promise.all([
    listEmployees(),
    supabase
      .from('rotation_log')
      .select('employee_id,sign_on_date,sign_off_date,installation:installations(name)')
      .order('sign_on_date'),
    listDocumentTypes(),
    listAllEmployeeDocuments(),
    listAvailability(),
  ])
  const err = empRes.error || rotRes.error || dtRes.error || docsRes.error || avRes.error
  if (err) throw new Error(err.message)

  const employees = empRes.data ?? []
  const docTypes = dtRes.data ?? []

  const rotByEmp = new Map()
  for (const r of rotRes.data ?? []) {
    if (!rotByEmp.has(r.employee_id)) rotByEmp.set(r.employee_id, [])
    rotByEmp.get(r.employee_id).push(r)
  }
  const docsByEmp = new Map()
  for (const d of docsRes.data ?? []) {
    if (!docsByEmp.has(d.employee_id)) docsByEmp.set(d.employee_id, [])
    docsByEmp.get(d.employee_id).push(d)
  }
  const avByEmp = new Map((avRes.data ?? []).map((a) => [a.employee_id, a]))

  const headerRow = [...IMPORT_COLUMNS, ...READONLY_COLUMNS.map(readonlyHeader)]
  const aoa = [headerRow]

  for (const e of employees) {
    const rots = rotByEmp.get(e.id) ?? []
    const closed = rots
      .filter((r) => r.sign_off_date)
      .sort((a, b) => a.sign_off_date.localeCompare(b.sign_off_date))
    const open = rots.find((r) => !r.sign_off_date)
    const recent3 = closed.slice(-3) // most recent 3, already oldest-first

    const empDocs = docsByEmp.get(e.id) ?? []
    const cert = computeCertStatus(e.designation_id, docTypes, empDocs, today)
    const dob = dobMismatch(empDocs, docTypes)
    const certStatus = cert.certCurrent
      ? 'Certs OK'
      : `${cert.problems.length} issue${cert.problems.length === 1 ? '' : 's'}`
    const certIssues = cert.problems.map((p) => `${p.name} (${p.reason})`).join(', ')

    let daysSince = ''
    if (!e.current_installation_id) {
      const last = closed[closed.length - 1]
      if (last?.sign_off_date) daysSince = daysBetween(last.sign_off_date, today)
    }

    const av = avByEmp.get(e.id)
    let confirmation = ''
    if (av) {
      if (isConfirmedLive(av)) confirmation = 'Confirmed'
      else if (av.last_call_outcome === 'declined') confirmation = 'Declined'
      else confirmation = 'Unconfirmed'
    }

    const row = {
      emp_id: e.emp_id,
      full_name: e.full_name,
      designation: e.designation?.name ?? '',
      phone: e.phone ?? '',
      employment_status: e.employment_status,
      base_location_type: e.base_location_type ?? '',
      recall_lead_time_days: e.recall_lead_time_days ?? '',
      notes: e.notes ?? '',
      current_location: open ? open.installation?.name ?? '' : '',
      current_sign_on: open?.sign_on_date ?? '',
      stint_1_installation: recent3[0]?.installation?.name ?? '',
      stint_1_sign_on: recent3[0]?.sign_on_date ?? '',
      stint_1_sign_off: recent3[0]?.sign_off_date ?? '',
      stint_2_installation: recent3[1]?.installation?.name ?? '',
      stint_2_sign_on: recent3[1]?.sign_on_date ?? '',
      stint_2_sign_off: recent3[1]?.sign_off_date ?? '',
      stint_3_installation: recent3[2]?.installation?.name ?? '',
      stint_3_sign_on: recent3[2]?.sign_on_date ?? '',
      stint_3_sign_off: recent3[2]?.sign_off_date ?? '',
      cert_status: certStatus,
      cert_issues: certIssues,
      days_since_signoff: daysSince,
      confirmation_status: confirmation,
      dob_mismatch: dob.mismatch ? 'Yes' : '',
    }
    aoa.push([...IMPORT_COLUMNS, ...READONLY_COLUMNS].map((c) => row[c] ?? ''))
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.writeFile(wb, `employees_export_${today}.xlsx`)
}

// ---------------------------------------------------------------------
// Template — header row, a plain-language explanation row, and an example
// data row. Read-only columns are tagged and explained as ignored on import.
// ---------------------------------------------------------------------
const COLUMN_HELP = {
  emp_id: 'Required. Unique employee ID (letters/numbers). Stored uppercase.',
  full_name: 'Required. Employee full name.',
  designation: 'Required. Must match a designation name exactly.',
  phone: 'Optional. Contact number.',
  employment_status: 'Optional. "active" or "inactive". Defaults to active if blank.',
  base_location_type: 'Optional. guesthouse or hometown (stored as hometown, displays as Out of town). Leave blank if unknown.',
  recall_lead_time_days: 'Optional. Days of advance notice needed for travel to base. Numbers only. Leave blank if not applicable.',
  notes: 'Optional. Free text.',
  current_location: 'Optional. Installation they are CURRENTLY on (with current_sign_on). Leave blank if on base.',
  current_sign_on: 'Optional. Date they boarded their current location (YYYY-MM-DD). Both this and current_location, or neither.',
  stint_1_installation: 'Optional. Oldest completed stint — installation name.',
  stint_1_sign_on: 'Optional. Oldest stint sign-on date (YYYY-MM-DD).',
  stint_1_sign_off: 'Optional. Oldest stint sign-off date (past date).',
  stint_2_installation: 'Optional. Next stint — installation name. Requires stint 1.',
  stint_2_sign_on: 'Optional. Stint 2 sign-on date.',
  stint_2_sign_off: 'Optional. Stint 2 sign-off date (after stint 1 sign-off).',
  stint_3_installation: 'Optional. Most recent completed stint — installation. Requires stints 1 & 2.',
  stint_3_sign_on: 'Optional. Stint 3 sign-on date.',
  stint_3_sign_off: 'Optional. Stint 3 sign-off date (before current_sign_on if any).',
  cert_status: '[Read Only] Ignored on import. Export only.',
  cert_issues: '[Read Only] Ignored on import. Export only.',
  days_since_signoff: '[Read Only] Ignored on import. Export only.',
  confirmation_status: '[Read Only] Ignored on import. Export only.',
}

const COLUMN_EXAMPLE = {
  emp_id: 'E1001',
  full_name: 'Ravi Kumar',
  designation: 'Cook',
  phone: '9876543210',
  employment_status: 'active',
  base_location_type: 'hometown',
  recall_lead_time_days: '2',
  notes: 'Senior cook',
  current_location: 'ICP',
  current_sign_on: '2026-05-01',
  stint_1_installation: 'NQO',
  stint_1_sign_on: '2025-06-01',
  stint_1_sign_off: '2025-08-10',
  stint_2_installation: 'ICP',
  stint_2_sign_on: '2025-09-15',
  stint_2_sign_off: '2025-11-20',
  stint_3_installation: 'BHN',
  stint_3_sign_on: '2026-01-05',
  stint_3_sign_off: '2026-03-15',
  cert_status: '',
  cert_issues: '',
  days_since_signoff: '',
  confirmation_status: '',
}

export async function downloadTemplate() {
  const XLSX = await loadXLSX()
  const cols = [...IMPORT_COLUMNS, ...READONLY_COLUMNS]
  const headerRow = [...IMPORT_COLUMNS, ...READONLY_COLUMNS.map(readonlyHeader)]
  const helpRow = cols.map((c) => COLUMN_HELP[c] ?? '')
  const exampleRow = cols.map((c) => COLUMN_EXAMPLE[c] ?? '')
  const ws = XLSX.utils.aoa_to_sheet([headerRow, helpRow, exampleRow])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.writeFile(wb, 'employee_import_template.xlsx')
}
