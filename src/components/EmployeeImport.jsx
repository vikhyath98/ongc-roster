import { useState } from 'react'
import Modal from './Modal'
import {
  parseWorkbook,
  validateRows,
  importValidRows,
  downloadTemplate,
  exportEmployees,
} from '../lib/importEmployees'
import { useAuth } from '../context/AuthContext'

// Bulk .xlsx import/export with a validated preview (build answers §10).
export default function EmployeeImport({
  open,
  designations,
  installations = [],
  existingEmpIds,
  maxServiceDays = 70,
  onClose,
  onImported,
}) {
  const { user } = useAuth()
  const [step, setStep] = useState('select') // select | preview | done
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
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
      const validated = validateRows(parsed, designations, installations, existingEmpIds)
      setRows(validated)
      setFileName(file.name)
      setStep('preview')
    } catch (err) {
      setError(err.message || 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    setError('')
    setExporting(true)
    try {
      await exportEmployees()
    } catch (err) {
      setError(err.message || 'Could not export.')
    } finally {
      setExporting(false)
    }
  }

  async function handleImport() {
    setBusy(true)
    setError('')
    const { inserted, historyStints, onboarded, error: importErr } = await importValidRows(rows, {
      maxServiceDays,
      userId: user?.id,
    })
    setBusy(false)
    if (importErr) {
      setError(importErr.message)
      return
    }
    setResult({ inserted, historyStints, onboarded })
    setStep('done')
    onImported?.()
  }

  const validCount = rows.filter((r) => r.valid).length
  const invalidCount = rows.length - validCount

  return (
    <Modal
      open={open}
      title="Import / Export employees"
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
            Upload an .xlsx with <strong>emp_id</strong>, <strong>full_name</strong>,{' '}
            <strong>designation</strong> (required) plus optional details, a{' '}
            <strong>current_location</strong> + <strong>current_sign_on</strong> pair, and up to
            three completed rotation stints (<strong>stint_1…3</strong>). Download the template for
            the exact columns and rules. Every row is validated and shown for review before
            anything is saved.
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
          <button type="button" className="btn btn--ghost" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : '⬇ Export all employees'}
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
              Rows with errors won’t be imported. Fix them in the sheet and re-upload to include
              them, or import just the valid rows now.
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
                    {r.data.employment_status === 'inactive' ? ' · inactive' : ''}
                  </span>
                  {r.data.stints?.length > 0 && (
                    <div className="import-row__onboard">
                      📜 {r.data.stints.length} past stint{r.data.stints.length === 1 ? '' : 's'}:{' '}
                      {r.data.stints
                        .map((s) => `${s.installation_name ?? '?'} ${s.sign_on}→${s.sign_off}`)
                        .join(', ')}
                    </div>
                  )}
                  {r.data.current && (
                    <div className="import-row__onboard">
                      🚁 Currently at {r.data.current.installation_name} from {r.data.current.sign_on}
                    </div>
                  )}
                </div>
                {r.warnings?.length > 0 && (
                  <ul className="import-row__warnings">
                    {r.warnings.map((msg, idx) => (
                      <li key={idx}>⚠ {msg}</li>
                    ))}
                  </ul>
                )}
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
            {result?.inserted === 1 ? '' : 's'}
            {result?.historyStints > 0 ? `, ${result.historyStints} history stint${result.historyStints === 1 ? '' : 's'}` : ''}
            {result?.onboarded > 0 ? `, ${result.onboarded} currently offshore` : ''}.
          </p>
          {invalidCount > 0 && (
            <p className="muted">
              {invalidCount} row{invalidCount === 1 ? '' : 's'} with errors{' '}
              {invalidCount === 1 ? 'was' : 'were'} not imported. Fix and re-upload to add{' '}
              {invalidCount === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
