import { useState } from 'react'
import Modal from './Modal'

const OUTCOMES = [
  { key: 'no_answer', label: 'No answer' },
  { key: 'call_back', label: 'Call back' },
  { key: 'confirmed', label: 'Confirmed ✅' },
  { key: 'declined', label: 'Declined' },
]

// Log a call outcome for a base employee (SPEC.md §3.6, §6.6).
export default function CallDialog({ open, candidate, onClose, onLog }) {
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // Reset when (re)opened for a candidate.
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setOutcome('')
      setNotes('')
      setBusy(false)
    }
  }

  if (!candidate) return null

  async function submit() {
    if (!outcome) return
    setBusy(true)
    await onLog(outcome, notes)
    setBusy(false)
  }

  return (
    <Modal
      open={open}
      title={`Log call — ${candidate.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!outcome || busy} onClick={submit}>
            {busy ? 'Saving…' : 'Log call'}
          </button>
        </>
      }
    >
      <p className="muted">Outcome of the call (increments call count and logs history).</p>
      <div className="outcome-grid">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            className={'outcome-btn' + (outcome === o.key ? ' outcome-btn--on' : '')}
            onClick={() => setOutcome(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </Modal>
  )
}
