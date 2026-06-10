// Round-trip test for the bulk-import template (Bug 2 regression guard):
// generate the template the UI produces, then parse it with the real
// validator and assert there are zero header errors.
//
//   node scripts/check-import-template.mjs
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

// The app uses Vite-style extensionless imports ('./supabase'). Teach Node's
// resolver to fall back to a '.js' extension so we can import the real module.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[mc]?js$/.test(specifier)) {
        return nextResolve(specifier + '.js', context)
      }
      throw err
    }
  },
})

// SheetJS needs fs explicitly wired for writeFile in Node (the browser build
// doesn't). downloadTemplate() shares this same cached module instance.
import * as fs from 'node:fs'
const XLSX = await import('xlsx')
XLSX.set_fs(fs)

const { downloadTemplate, parseWorkbook, validateRows } = await import(
  '../src/lib/importEmployees.js'
)

const TEMPLATE = 'employee_import_template.xlsx'
let failed = false

try {
  // 1) Generate the template (in Node, SheetJS writeFile writes to disk).
  await downloadTemplate()
  if (!existsSync(TEMPLATE)) throw new Error('template file was not generated')
  console.log('✓ template generated:', TEMPLATE)

  // 2) Parse it back through the real importer (file-like with arrayBuffer()).
  const buf = readFileSync(TEMPLATE)
  const file = {
    name: TEMPLATE,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
  const rows = await parseWorkbook(file) // throws if headers are missing
  console.log('✓ parsed with zero header errors. Rows:', rows.length)
  console.log('  first row:', JSON.stringify(rows[0]))

  // 3) Validate against designations + installations that cover the examples
  //    (template now includes an already-offshore example at "ICP").
  const designations = [{ id: 'd-cook', name: 'Cook' }]
  const installations = [{ id: 'i-icp', name: 'ICP' }]
  const validated = validateRows(rows, designations, installations, [])
  const allValid = validated.every((r) => r.valid)
  console.log(allValid ? '✓ example rows validate' : '✗ example rows had errors:')
  if (!allValid) {
    failed = true
    validated.filter((r) => !r.valid).forEach((r) => console.log('   row', r.rowNumber, r.errors))
  }

  // 4) The onboarded example row must resolve location + sign-on date.
  const onboardRow = validated.find((r) => r.data.location_id)
  if (!onboardRow || onboardRow.data.installation_name !== 'ICP' || !onboardRow.data.sign_on_date) {
    failed = true
    console.log('✗ onboarding columns did not resolve as expected')
  } else {
    console.log('✓ onboarding row resolved:', onboardRow.data.installation_name, onboardRow.data.sign_on_date)
  }

  // 5) location without sign_on_date must be rejected with the exact message.
  const badRows = validateRows(
    [{ emp_id: 'E9', full_name: 'No Date', designation: 'Cook', phone: '', notes: '', location: 'ICP', sign_on_date: '' }],
    designations,
    installations,
    []
  )
  if (badRows[0].valid || !badRows[0].errors.includes('sign_on_date is required when location is provided.')) {
    failed = true
    console.log('✗ missing sign_on_date was not rejected correctly:', badRows[0].errors)
  } else {
    console.log('✓ location without sign_on_date is rejected')
  }

  // 6) unknown location must be rejected.
  const badLoc = validateRows(
    [{ emp_id: 'E10', full_name: 'Bad Loc', designation: 'Cook', phone: '', notes: '', location: 'NOWHERE', sign_on_date: '2024-01-15' }],
    designations,
    installations,
    []
  )
  if (badLoc[0].valid || !badLoc[0].errors.includes('Location not recognised — must match an installation name exactly.')) {
    failed = true
    console.log('✗ unknown location was not rejected correctly:', badLoc[0].errors)
  } else {
    console.log('✓ unknown location is rejected')
  }
} catch (err) {
  failed = true
  console.error('✗ FAILED:', err.message)
} finally {
  if (existsSync(TEMPLATE)) rmSync(TEMPLATE)
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS')
process.exit(failed ? 1 : 0)
