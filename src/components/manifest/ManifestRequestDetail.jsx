import { useEffect, useMemo, useState } from 'react'
import {
  getManifestRequest,
  updateManifestRequest,
  updateManifestRequestStatus,
  cancelPairing,
  addManifestItems,
} from '../../lib/manifest'
import Modal from '../Modal'
import LineItemPicker from './LineItemPicker'

const STATUS_LABEL = {
  sent: 'Sent',
  partially_approved: 'Partially approved',
  approved: 'Approved',
  rejected: 'Rejected',
}
const STATUS_ORDER = ['sent', 'partially_approved', 'approved', 'rejected']

const PAIRING_PILL = {
  pending: { label: 'Pending', cls: 'pill' },
  rfm_listed: { label: 'RFM listed', cls: 'pill manifest-status--sent' },
  boarded: { label: 'Boarded', cls: 'pill pill--ok' },
  dropped: { label: 'Dropped', cls: 'pill pill--warn' },
  no_show: { label: 'No-show', cls: 'pill pill--bad' },
  cancelled: { label: 'Cancelled', cls: 'pill pill--muted' },
}

export default function ManifestRequestDetail({
  requestId,
  installations,
  candidates,
  designations,
  requirements,
  offshore,
  thresholds,
  onClose,
  onChanged,
}) {
  const [req, setReq] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Editable field buffers.
  const [installationId, setInstallationId] = useState('')
  const [requestDate, setRequestDate] = useState('')
  const [notes, setNotes] = useState('')

  async function load() {
    if (!requestId) return
    setLoading(true)
    setError('')
    const { data, error: err } = await getManifestRequest(requestId)
    if (err) setError(err.message)
    else {
      setReq(data)
      setInstallationId(data.installation_id ?? '')
      setRequestDate(data.request_date ?? '')
      setNotes(data.notes ?? '')
    }
    setLoading(false)
  }

  useEffect(() => {
    if (requestId) load()
    else setReq(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  const hasRfm = (req?.rfms?.length ?? 0) > 0

  // Every employee already in this request (incoming + outgoing, incl.
  // cancelled), so the add-picker can't re-add a deliberately removed person.
  const usedIds = useMemo(() => {
    const s = new Set()
    for (const it of req?.items ?? []) {
      if (it.employee_id) s.add(it.employee_id)
      if (it.replacing_employee_id) s.add(it.replacing_employee_id)
    }
    return s
  }, [req])

  async function saveStatus(status) {
    const { error: err } = await updateManifestRequestStatus(requestId, status)
    if (err) setError(err.message)
    else {
      await load()
      onChanged?.()
    }
  }

  async function saveFields() {
    setBusy(true)
    setError('')
    // Installation/date only sent when still unlocked; notes always.
    const fields = { notes }
    if (!hasRfm) {
      fields.installationId = installationId
      fields.requestDate = requestDate
    }
    const { error: err } = await updateManifestRequest(requestId, fields)
    setBusy(false)
    if (err) setError(err.message)
    else {
      await load()
      onChanged?.()
    }
  }

  async function doCancel(pairingId) {
    setBusy(true)
    setError('')
    const { error: err } = await cancelPairing(pairingId)
    setBusy(false)
    if (err) setError(err.message)
    else {
      await load()
      onChanged?.()
    }
  }

  async function addItem(item) {
    setBusy(true)
    setError('')
    const { error: err } = await addManifestItems(requestId, [item])
    setBusy(false)
    if (err) setError(err.message)
    else {
      await load()
      onChanged?.()
    }
  }

  return (
    <Modal
      open={Boolean(requestId)}
      title="Manifest request"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {req && (
        <>
          <div className="board-controls">
            <label className="field">
              <span>Installation{hasRfm ? ' (locked — RFM logged)' : ''}</span>
              <select
                value={installationId}
                disabled={hasRfm}
                onChange={(e) => setInstallationId(e.target.value)}
              >
                {installations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.type})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date{hasRfm ? ' (locked)' : ''}</span>
              <input
                type="date"
                value={requestDate}
                disabled={hasRfm}
                onChange={(e) => setRequestDate(e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span>Status</span>
            <select value={req.status} onChange={(e) => saveStatus(e.target.value)}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={saveFields}>
            Save changes
          </button>

          {hasRfm && (
            <p className="field-hint muted">
              RFM{req.rfms.length === 1 ? '' : 's'} logged: {req.rfms.map((r) => r.rfm_number).join(', ')}
            </p>
          )}

          <h3 className="section-heading">Line items ({req.items?.length ?? 0})</h3>
          <ul className="card-list">
            {(req.items ?? []).map((it) => {
              const pairing = it.pairings?.[0] ?? null
              const pill = pairing ? PAIRING_PILL[pairing.status] : null
              const rfmNo = pairing?.rfm_line_item?.rfm?.rfm_number
              const lockedPastPending =
                pairing && pairing.status !== 'pending' && pairing.status !== 'cancelled'
              return (
                <li key={it.id}>
                  <div className="roster-card roster-card--col">
                    <div className="roster-card__row">
                      <div className="emp-card__main">
                        <span className="emp-card__name">{it.employee?.full_name ?? '—'}</span>
                        <span className="emp-card__meta">
                          {it.employee?.emp_id} · {it.employee?.designation?.name ?? '—'}
                        </span>
                        <span className="reserve-sub">
                          {it.replacing
                            ? `replacing ${it.replacing.full_name} (${it.replacing.designation?.name ?? '—'})`
                            : it.reason || 'no direct replacement'}
                          {it.is_emergency_exception ? ' · ⚠ emergency exception' : ''}
                        </span>
                      </div>
                      {pill ? <span className={pill.cls}>{pill.label}</span> : null}
                    </div>

                    {pairing && pairing.status === 'pending' && (
                      <div className="roster-card__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => doCancel(pairing.id)}
                        >
                          Cancel line item
                        </button>
                      </div>
                    )}
                    {lockedPastPending && (
                      <span className="muted rfm-locked">
                        🔒 Already logged on RFM {rfmNo ? `#${rfmNo}` : ''} — locked
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <h3 className="section-heading">Add line item</h3>
          <LineItemPicker
            installationId={installationId}
            candidates={candidates}
            designations={designations}
            requirements={requirements}
            offshore={offshore}
            thresholds={thresholds}
            usedIds={usedIds}
            onAdd={addItem}
          />
        </>
      )}
    </Modal>
  )
}
