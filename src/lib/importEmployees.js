import { supabase } from './supabase'
import { addDays } from './dates'

// SheetJS is large and only needed for import/template, so load it on demand
// (keeps it out of the initial bundle — matters for the mobile PWA).
const loadXLSX = () => import('xlsx')

// Bulk employee import from .xlsx (build answers §10).
// Reads emp_id, full_name, designation, phone, notes (required: the first
// three) plus optional location + sign_on_date. When a valid location and
// sign-on date are present, the row is onboarded on import (rotation_log +
// current_installation_id), exactly like onboardEmployee(). Invalid rows are
// surfaced in a preview — never silently skipped.

// Accepted header spellings -> canonical field.
const HEADER_SYNONYMS = {
  emp_id: ['emp_id', 'empid', 'employee id', 'employeeid', 'id', 'employee_id'],
  full_name: ['full_name', 'fullname', 'name', 'employee name', 'employeename'],
  designation: ['designation', 'role', 'post'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number', 'phoneno'],
  notes: ['notes', 'note', 'remark', 'remarks'],
  location: ['location', 'installation', 'current location', 'posting', 'site', 'platform rig'],
  sign_on_date: ['sign_on_date', 'sign on date', 'signon date', 'sign on', 'onboard date', 'boarding date', 'date of boarding'],
}

const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s._-]+/g, ' ').trim()

// Pre-normalise the synonyms so matching is case-insensitive, whitespace-
// trimmed, and separator-agnostic ("emp_id", "Emp ID", "empid" all match).
// Both the header and the synonym go through normalize(), so they must be
// compared in the same normalised form.
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

// Normalise a sign-on date cell to ISO 'YYYY-MM-DD'.
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
        'Expected headers like emp_id, full_name, designation, phone, notes, location, sign_on_date.'
    )
  }

  const pick = (row, field) => (headerMap[field] ? String(row[headerMap[field]] ?? '').trim() : '')
  return json.map((row) => ({
    emp_id: pick(row, 'emp_id'),
    full_name: pick(row, 'full_name'),
    designation: pick(row, 'designation'),
    phone: pick(row, 'phone'),
    notes: pick(row, 'notes'),
    location: pick(row, 'location'),
    sign_on_date: pick(row, 'sign_on_date'),
  }))
}

// Validate parsed rows against designations, installations and existing
// emp_ids. Resolves an optional location+sign_on_date into onboarding data.
export function validateRows(rows, designations, installations, existingEmpIds) {
  const byDesignation = new Map(designations.map((d) => [normalize(d.name), d]))
  const byInstallation = new Map((installations ?? []).map((i) => [normalize(i.name), i]))
  const existing = new Set((existingEmpIds ?? []).map((id) => String(id).toUpperCase()))
  const seenInFile = new Map() // upper emp_id -> first row number

  return rows.map((raw, i) => {
    const rowNumber = i + 2 // +1 header, +1 to 1-base
    const errors = []
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

    // Optional onboarding: location + sign_on_date.
    let location_id = null
    let installation_name = null
    let sign_on_date = ''
    if (data.location) {
      const inst = byInstallation.get(normalize(data.location))
      if (!inst) {
        errors.push('Location not recognised — must match an installation name exactly.')
      } else {
        location_id = inst.id
        installation_name = inst.name
      }
      if (!data.sign_on_date) {
        errors.push('sign_on_date is required when location is provided.')
      } else {
        const iso = toISODate(data.sign_on_date)
        if (iso === null) errors.push(`sign_on_date "${data.sign_on_date}" is not a valid date (use YYYY-MM-DD).`)
        else sign_on_date = iso
      }
    }

    return {
      rowNumber,
      data: { ...data, designation_id, location_id, installation_name, sign_on_date },
      errors,
      valid: errors.length === 0,
    }
  })
}

// Insert valid rows, then onboard any with a resolved location+sign_on_date.
// Returns { inserted, onboarded, error }.
export async function importValidRows(validated, { maxServiceDays = 70, userId } = {}) {
  const validRows = validated.filter((r) => r.valid)
  if (validRows.length === 0) return { inserted: 0, onboarded: 0, error: null }

  const payload = validRows.map((r) => ({
    emp_id: r.data.emp_id.toUpperCase(),
    full_name: r.data.full_name,
    designation_id: r.data.designation_id,
    phone: r.data.phone || null,
    notes: r.data.notes || null,
    employment_status: 'active',
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
    return { inserted: 0, onboarded: 0, error: { ...error, message } }
  }

  // Onboard rows that carried a valid location + sign-on date.
  const idByEmpId = new Map(inserted.map((e) => [e.emp_id.toUpperCase(), e.id]))
  const toOnboard = validRows.filter((r) => r.data.location_id && r.data.sign_on_date)

  if (toOnboard.length > 0) {
    const stints = toOnboard.map((r) => ({
      employee_id: idByEmpId.get(r.data.emp_id.toUpperCase()),
      installation_id: r.data.location_id,
      sign_on_date: r.data.sign_on_date,
      expected_rotation_date: addDays(r.data.sign_on_date, maxServiceDays),
      onboarded_by: userId ?? null,
    }))
    const { error: stintErr } = await supabase.from('rotation_log').insert(stints)
    if (stintErr) {
      return {
        inserted: inserted.length,
        onboarded: 0,
        error: { message: `Employees imported, but onboarding failed: ${stintErr.message}` },
      }
    }

    // Mirror current_installation_id, grouped by installation.
    const byInstall = new Map()
    for (const r of toOnboard) {
      const id = idByEmpId.get(r.data.emp_id.toUpperCase())
      if (!byInstall.has(r.data.location_id)) byInstall.set(r.data.location_id, [])
      byInstall.get(r.data.location_id).push(id)
    }
    for (const [installationId, ids] of byInstall) {
      const { error: mirrorErr } = await supabase
        .from('employees')
        .update({ current_installation_id: installationId })
        .in('id', ids)
      if (mirrorErr) {
        return {
          inserted: inserted.length,
          onboarded: 0,
          error: { message: `Employees imported and stints created, but location update failed: ${mirrorErr.message}` },
        }
      }
    }
  }

  return { inserted: inserted.length, onboarded: toOnboard.length, error: null }
}

// Generate and download a starter .xlsx template, including the two optional
// onboarding columns with examples (one on-base, one already offshore).
export async function downloadTemplate() {
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.json_to_sheet([
    {
      emp_id: 'E1001',
      full_name: 'Ravi Kumar',
      designation: 'Cook',
      phone: '9876543210',
      notes: 'On base — leave location & sign_on_date blank',
      location: '',
      sign_on_date: '',
    },
    {
      emp_id: 'E1002',
      full_name: 'Sunil Rao',
      designation: 'Cook',
      phone: '9876500000',
      notes: 'Already offshore — set location + sign_on_date (both optional)',
      location: 'ICP',
      sign_on_date: '2024-01-15',
    },
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.writeFile(wb, 'employee_import_template.xlsx')
}
