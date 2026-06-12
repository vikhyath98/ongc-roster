import { useEffect, useState } from 'react'
import Modal from './Modal'
import { bulkConfirmAvailability } from '../lib/reserve'
import { useAuth } from '../context/AuthContext'

// Confirm availability for several selected employees at once. Anyone already
// offshore is skipped (they don't need confirmation).
export default function BulkConfirmAvailability({ open, employees, onClose, onDone }) {
  const { user } = useAuth()
  const [confirmedForDate, setConfirmedForDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open) return
    setConfirmedForDate('')
    setError('')
    setResult(null)
  }, [open])

  async function confirm() {
    setBusy(true)
    setError('')
    const res = await bulkConfirmAvailability(employees, { confirmedForDate, userId: user?.id })
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
      title={`Confirm availability — ${employees.length} employee${employees.length === 1 ? '' : 's'}`}
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
            <button type="button" className="btn btn--primary" disabled={busy} onClick={confirm}>
              {busy ? 'Confirming…' : 'Confirm'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="bulk-result">
          <p className="cert-summary cert-summary--ok">
            ✅ {result.confirmed} employee{result.confirmed === 1 ? '' : 's'} confirmed.
            {result.skipped > 0
              ? ` ${result.skipped} skipped (currently offshore).`
              : ''}
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            Marks these employees available to deploy (confirmed, with an expiry from
            confirmation_validity_days). Anyone currently offshore is skipped automatically.
          </p>

          <label className="field">
            <span>Confirmed for date (optional)</span>
            <input
              type="date"
              value={confirmedForDate}
              onChange={(e) => setConfirmedForDate(e.target.value)}
            />
          </label>
          <p className="field-hint muted">The expected mobilisation date. Leave blank if unknown.</p>

          <h3 className="section-heading">Selected employees</h3>
          <ul className="confirm-names">
            {employees.map((e) => (
              <li key={e.id}>
                {e.full_name}
                {e.current_installation_id && <span className="muted"> · offshore (skipped)</span>}
              </li>
            ))}
          </ul>

          {error && <p className="banner banner--error">{error}</p>}
        </>
      )}
    </Modal>
  )
}
