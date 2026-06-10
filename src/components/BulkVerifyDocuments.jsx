import { useEffect, useState } from 'react'
import Modal from './Modal'
import { bulkVerifyDocuments, suggestedExpiry } from '../lib/documents'
import { useAuth } from '../context/AuthContext'

// Bulk-verify document types across several selected employees.
export default function BulkVerifyDocuments({ open, employees, docTypes, onClose, onDone }) {
  const { user } = useAuth()
  const [typeIds, setTypeIds] = useState(new Set())
  const [issueDate, setIssueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  // Reset each time the modal opens.
  useEffect(() => {
    if (!open) return
    setTypeIds(new Set())
    setIssueDate('')
    setExpiryDate('')
    setError('')
    setResult(null)
  }, [open])

  function toggleType(id) {
    setTypeIds((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Auto-suggest expiry: use the largest default validity among selected types.
  function onIssueChange(value) {
    setIssueDate(value)
    if (value && !expiryDate) {
      const validity = docTypes
        .filter((dt) => typeIds.has(dt.id) && dt.default_validity_days)
        .reduce((max, dt) => Math.max(max, dt.default_validity_days), 0)
      if (validity) setExpiryDate(suggestedExpiry(value, validity))
    }
  }

  async function confirm() {
    setBusy(true)
    setError('')
    const res = await bulkVerifyDocuments(
      employees,
      [...typeIds],
      { issueDate, expiryDate },
      docTypes,
      user?.id
    )
    setBusy(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    setResult(res)
    onDone?.()
  }

  return (
    <Modal
      open={open}
      title={`Verify documents — ${employees.length} employee${employees.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        result ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || typeIds.size === 0}
              onClick={confirm}
            >
              {busy ? 'Verifying…' : `Verify ${typeIds.size || ''}`.trim()}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="bulk-result">
          <p className="cert-summary cert-summary--ok">
            ✅ {result.verified} document{result.verified === 1 ? '' : 's'} verified across{' '}
            {result.employeesAffected} employee{result.employeesAffected === 1 ? '' : 's'}.
          </p>
          {result.skipped > 0 && (
            <p className="muted">
              {result.skipped} skipped (document type not applicable to that designation).
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="muted">
            Marks the chosen documents <strong>verified</strong> for all selected employees.
            Documents that don’t apply to an employee’s designation are skipped automatically.
          </p>

          <h3 className="section-heading">Document types</h3>
          <ul className="bulk-types">
            {docTypes.map((dt) => (
              <li key={dt.id}>
                <button
                  type="button"
                  className={'bulk-type' + (typeIds.has(dt.id) ? ' bulk-type--on' : '')}
                  onClick={() => toggleType(dt.id)}
                  aria-pressed={typeIds.has(dt.id)}
                >
                  <span className={'pick-card__check' + (typeIds.has(dt.id) ? ' pick-card__check--on' : '')}>
                    {typeIds.has(dt.id) ? '✓' : ''}
                  </span>
                  <span className="bulk-type__name">
                    {dt.name}
                    <span className="muted bulk-type__tag">
                      {dt.applies_to_all ? 'Universal' : 'Specific'}
                      {dt.default_validity_days ? ` · ${dt.default_validity_days}d` : ''}
                      {dt.tracks_dates === false ? ' · no dates' : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="board-controls">
            <label className="field">
              <span>Issue date (optional)</span>
              <input type="date" value={issueDate} onChange={(e) => onIssueChange(e.target.value)} />
            </label>
            <label className="field">
              <span>Expiry date (optional)</span>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </label>
          </div>
          <p className="field-hint muted">
            Dates apply only to date-tracking documents; Aadhaar/PAN ignore them. Leave blank to
            keep any existing dates.
          </p>

          {error && <p className="banner banner--error">{error}</p>}
        </>
      )}
    </Modal>
  )
}
