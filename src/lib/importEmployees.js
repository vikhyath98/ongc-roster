import { supabase } from './supabase'

// SheetJS is large and only needed for import/template, so load it on demand
// (keeps it out of the initial bundle — matters for the mobile PWA).
const loadXLSX = () => import('xlsx')

// Bulk employee import from .xlsx (build answers §10).
// Reads emp_id, full_name, designation, phone, notes. Validates each row
// (designation exists, emp_id unique vs DB and vs the file). Invalid rows are
// surfaced in a preview — never silently skipped.

// Accepted header spellings -> canonical field.
const HEADER_SYNONYMS = {
  emp_id: ['emp_id', 'empid', 'employee id', 'employeeid', 'id', 'employee_id'],
  full_name: ['full_name', 'fullname', 'name', 'employee name', 'employeename'],
  designation: ['designation', 'role', 'post'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number', 'phoneno'],
  notes: ['notes', 'note', 'remark', 'remarks'],
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

// Parse the first worksheet into canonical rows. Throws on unreadable files.
export async function parseWorkbook(file) {
  const XLSX = await loadXLSX()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
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
        'Expected headers like emp_id, full_name, designation, phone, notes.'
    )
  }

  const pick = (row, field) => (headerMap[field] ? String(row[headerMap[field]] ?? '').trim() : '')
  return json.map((row) => ({
    emp_id: pick(row, 'emp_id'),
    full_name: pick(row, 'full_name'),
    designation: pick(row, 'designation'),
    phone: pick(row, 'phone'),
    notes: pick(row, 'notes'),
  }))
}

// Validate parsed rows against the designation list and existing emp_ids.
export function validateRows(rows, designations, existingEmpIds) {
  const byName = new Map(designations.map((d) => [normalize(d.name), d]))
  const existing = new Set((existingEmpIds ?? []).map((id) => id.toLowerCase()))
  const seenInFile = new Map() // lower emp_id -> first row number

  return rows.map((data, i) => {
    const rowNumber = i + 2 // +1 header, +1 to 1-base
    const errors = []

    if (!data.emp_id) errors.push('Employee ID is blank')
    if (!data.full_name) errors.push('Name is blank')

    let designation_id = null
    if (!data.designation) {
      errors.push('Designation is blank')
    } else {
      const match = byName.get(normalize(data.designation))
      if (!match) errors.push(`Unknown designation "${data.designation}"`)
      else designation_id = match.id
    }

    if (data.emp_id) {
      const key = data.emp_id.toLowerCase()
      if (existing.has(key)) errors.push(`Employee ID "${data.emp_id}" already exists`)
      if (seenInFile.has(key)) {
        errors.push(`Duplicate of row ${seenInFile.get(key)} in this file`)
      } else {
        seenInFile.set(key, rowNumber)
      }
    }

    return { rowNumber, data: { ...data, designation_id }, errors, valid: errors.length === 0 }
  })
}

// Insert the valid rows. Returns { inserted, error }.
export async function importValidRows(validated) {
  const payload = validated
    .filter((r) => r.valid)
    .map((r) => ({
      emp_id: r.data.emp_id.toUpperCase(),
      full_name: r.data.full_name,
      designation_id: r.data.designation_id,
      phone: r.data.phone || null,
      notes: r.data.notes || null,
      employment_status: 'active',
    }))
  if (payload.length === 0) return { inserted: 0, error: null }

  const { data, error } = await supabase.from('employees').insert(payload).select('id')
  if (error) {
    const message =
      error.code === '23505'
        ? 'A duplicate Employee ID slipped through (added since preview). Re-upload to refresh.'
        : error.message
    return { inserted: 0, error: { ...error, message } }
  }
  return { inserted: data.length, error: null }
}

// Generate and download a starter .xlsx template.
export async function downloadTemplate() {
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.json_to_sheet([
    { emp_id: 'E1001', full_name: 'Ravi Kumar', designation: 'Cook', phone: '9876543210', notes: '' },
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.writeFile(wb, 'employee_import_template.xlsx')
}
