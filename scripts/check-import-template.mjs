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

  // 3) Sanity-check validation against a designation list incl. the example.
  const designations = [{ id: 'd-cook', name: 'Cook' }]
  const validated = validateRows(rows, designations, [])
  const allValid = validated.every((r) => r.valid)
  console.log(allValid ? '✓ example row validates' : '✗ example row had errors:')
  if (!allValid) {
    failed = true
    validated.filter((r) => !r.valid).forEach((r) => console.log('   row', r.rowNumber, r.errors))
  }
} catch (err) {
  failed = true
  console.error('✗ FAILED:', err.message)
} finally {
  if (existsSync(TEMPLATE)) rmSync(TEMPLATE)
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS')
process.exit(failed ? 1 : 0)
