import { useState } from 'react'
import Modal from './Modal'
import {
  parseWorkbook,
  validateRows,
  importValidRows,
  downloadTemplate,
} from '../lib/importEmployees'

// Bulk .xlsx import with a validated preview (build answers §10).
export default function EmployeeImport({ open, designations, existingEmpIds, onClose, onImported }) {
  const [step, setStep] = useState('select') // select | preview | done
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  function reset() {
    setStep('select')
    setRows([])
    setFileName('')
    setError('')
    setResult(null)
  }

  function handleClose() {
    reset()
    onClose?.()
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file after a fix
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const parsed = await parseWorkbook(file)
      const validated = validateRows(parsed, designations, existingEmpIds)
      setRows(validated)
      setFileName(file.name)
      setStep('preview')
    } catch (err) {
      setError(err.message || 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  async function handleImport() {
    setBusy(true)
    setError('')
    const { inserted, error: importErr } = await importValidRows(rows)
    setBusy(false)
    if (importErr) {
      setError(importErr.message)
      return
    }
    setResult({ inserted })
    setStep('done')
    onImported?.()
  }

  const validCount = rows.filter((r) => r.valid).length
  const invalidCount = rows.length - validCount

  return (
    <Modal
      open={open}
      title="Bulk import employees"
      onClose={handleClose}
      footer={
        step === 'preview' ? (
          <>
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Choose another file
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || validCount === 0}
              onClick={handleImport}
            >
              {busy
                ? 'Importing…'
                : invalidCount > 0
                ? `Import ${validCount} valid (skip ${invalidCount})`
                : `Import ${validCount}`}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={handleClose}>
            {step === 'done' ? 'Done' : 'Close'}
          </button>
        )
      }
    >
      {step === 'select' && (
        <div className="import-select">
          <p className="muted">
            Upload an .xlsx with columns <strong>emp_id</strong>,{' '}
            <strong>full_name</strong>, <strong>designation</strong> (required) plus
            optional <strong>phone</strong> and <strong>notes</strong>. Every row is
            validated and shown for review before anything is saved.
          </p>
          <label className="btn btn--primary file-btn">
            {busy ? 'Reading…' : 'Choose .xlsx file'}
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile}
              hidden
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => downloadTemplate().catch((err) => setError(err.message))}
          >
            Download template
          </button>
          {error && <p className="banner banner--error">{error}</p>}
        </div>
      )}

      {step === 'preview' && (
        <div className="import-preview">
          <p className="muted import-file">{fileName}</p>
          <div className="import-summary">
            <span className="pill pill--ok">{validCount} valid</span>
            {invalidCount > 0 && <span className="pill pill--bad">{invalidCount} with errors</span>}
          </div>
          {invalidCount > 0 && (
            <p className="banner banner--info">
              Rows with errors won’t be imported. Fix them in the sheet and
              re-upload to include them, or import just the valid rows now.
            </p>
          )}
          {error && <p className="banner banner--error">{error}</p>}

          <ul className="import-rows">
            {rows.map((r) => (
              <li key={r.rowNumber} className={r.valid ? 'import-row' : 'import-row import-row--bad'}>
                <div className="import-row__head">
                  <span className="import-row__num">Row {r.rowNumber}</span>
                  <span className={`pill ${r.valid ? 'pill--ok' : 'pill--bad'}`}>
                    {r.valid ? 'OK' : 'Error'}
                  </span>
                </div>
                <div className="import-row__body">
                  <strong>{r.data.full_name || '—'}</strong>{' '}
                  <span className="muted">
                    {r.data.emp_id || '—'} · {r.data.designation || '—'}
                    {r.data.phone ? ` · ${r.data.phone}` : ''}
                  </span>
                </div>
                {!r.valid && (
                  <ul className="import-row__errors">
                    {r.errors.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 'done' && (
        <div className="import-done">
          <p className="cert-summary cert-summary--ok">
            ✅ Imported {result?.inserted ?? 0} employee
            {result?.inserted === 1 ? '' : 's'}.
          </p>
          {invalidCount > 0 && (
            <p className="muted">
              {invalidCount} row{invalidCount === 1 ? '' : 's'} with errors {invalidCount === 1 ? 'was' : 'were'}{' '}
              not imported. Fix and re-upload to add {invalidCount === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
