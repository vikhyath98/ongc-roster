import { useEffect, useMemo, useState } from 'react'
import { listManifestRequests, createManifestRequest } from '../../lib/manifest'
import { loadCandidates, canReplace } from '../../lib/reserve'
import { listInstallations, listDesignations } from '../../lib/reference'
import { listInstallationRequirements } from '../../lib/configAdmin'
import { listOffshoreStints } from '../../lib/boarding'
import { todayISO, daysInclusive } from '../../lib/dates'
import Modal from '../Modal'
import LineItemPicker from './LineItemPicker'
import ManifestRequestDetail from './ManifestRequestDetail'

const STATUS_LABEL = {
  sent: 'Sent',
  partially_approved: 'Partially approved',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default function ManifestRequests({ userId }) {
  const [requests, setRequests] = useState([])
  const [candidates, setCandidates] = useState([])
  const [installations, setInstallations] = useState([])
  const [requirements, setRequirements] = useState([])
  const [designations, setDesignations] = useState([])
  const [offshore, setOffshore] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)

  async function load() {
    setLoading(true)
    const [reqRes, candRes, instRes, reqmtRes, desRes, offRes] = await Promise.all([
      listManifestRequests(),
      loadCandidates(),
      listInstallations({ activeOnly: true }),
      listInstallationRequirements(),
      listDesignations(),
      listOffshoreStints(),
    ])
    if (reqRes.error || candRes.error) {
      setError((reqRes.error || candRes.error).message)
      setLoading(false)
      return
    }
    setRequests(reqRes.data ?? [])
    setCandidates(candRes.candidates ?? [])
    if (candRes.thresholds) setThresholds(candRes.thresholds)
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (!reqmtRes.error) setRequirements(reqmtRes.data ?? [])
    if (!desRes.error) setDesignations(desRes.data ?? [])
    if (!offRes.error) setOffshore(offRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <p className="muted">Loading requests…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  return (
    <div>
      <div className="toolbar">
        <span className="muted list-count">{requests.length} requests</span>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
          ＋ New request
        </button>
      </div>

      {requests.length === 0 ? (
        <p className="muted empty-state">No manifest requests yet.</p>
      ) : (
        <ul className="card-list">
          {requests.map((r) => (
            <li key={r.id}>
              <button type="button" className="emp-card" onClick={() => setDetailId(r.id)}>
                <div className="emp-card__main">
                  <span className="emp-card__name">📍 {r.installation?.name ?? '—'}</span>
                  <span className="emp-card__meta">
                    {r.request_date} · {r.items?.length ?? 0} employee
                    {(r.items?.length ?? 0) === 1 ? '' : 's'}
                    {r.items?.some((i) => i.is_emergency_exception) ? ' · ⚠ exception' : ''}
                  </span>
                </div>
                <span className={`pill manifest-status manifest-status--${r.status}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <NewRequestModal
        open={formOpen}
        userId={userId}
        installations={installations}
        candidates={candidates}
        requirements={requirements}
        designations={designations}
        offshore={offshore}
        thresholds={thresholds}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false)
          load()
        }}
      />

      <ManifestRequestDetail
        requestId={detailId}
        installations={installations}
        candidates={candidates}
        designations={designations}
        requirements={requirements}
        offshore={offshore}
        thresholds={thresholds}
        onClose={() => setDetailId(null)}
        onChanged={load}
      />
    </div>
  )
}

export function NewRequestModal({
  open,
  userId,
  installations,
  candidates,
  requirements,
  designations,
  offshore,
  thresholds,
  seedIncoming = [], // base employees pre-selected on the Board to send
  mode = 'new', // 'new' | 'retry' (affects labels only; lib auto-chains retries)
  onClose,
  onCreated,
}) {
  const [installationId, setInstallationId] = useState('')
  const [requestDate, setRequestDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([])
  // One row per pre-seeded incoming employee, each awaiting an outgoing to relieve.
  const [seedRows, setSeedRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const seeded = seedIncoming.length > 0

  useEffect(() => {
    if (!open) return
    // A retry seed carries lockedOutgoingId (the original failed pairing). Pre-fill
    // each relief's outgoing and derive the request's installation from it.
    const firstLocked = seedIncoming.find((c) => c.lockedOutgoingId)
    setInstallationId(
      firstLocked
        ? offshore.find((s) => s.employee?.id === firstLocked.lockedOutgoingId)?.installation_id ?? ''
        : ''
    )
    setRequestDate(todayISO())
    setNotes('')
    setItems([])
    setSeedRows(
      seedIncoming.map((c) => ({
        incomingId: c.id,
        incomingName: c.full_name,
        designationName: c.designation?.name ?? '',
        category: c.designation?.category?.name ?? null,
        outgoingId: c.lockedOutgoingId ?? '',
        locked: Boolean(c.lockedOutgoingId),
      }))
    )
    setBusy(false)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Names for the staged-items display.
  const nameById = useMemo(() => {
    const m = new Map()
    for (const c of candidates) m.set(c.id, c.full_name)
    for (const s of offshore) if (s.employee) m.set(s.employee.id, s.employee.full_name)
    return m
  }, [candidates, offshore])

  // Employees already used (incoming or outgoing) across seed rows + staged items.
  const usedIds = useMemo(() => {
    const s = new Set()
    for (const r of seedRows) {
      s.add(r.incomingId)
      if (r.outgoingId) s.add(r.outgoingId)
    }
    for (const it of items) {
      s.add(it.employeeId)
      if (it.replacingEmployeeId) s.add(it.replacingEmployeeId)
    }
    return s
  }, [seedRows, items])

  // Offshore employees at the chosen installation this incoming can relieve (tier
  // rule, §17.I), minus anyone already used elsewhere on this request.
  function outgoingOptionsFor(row) {
    if (!installationId) return []
    return offshore.filter(
      (s) =>
        s.installation_id === installationId &&
        canReplace(s.employee?.designation?.category?.name, row.category) &&
        (!usedIds.has(s.employee?.id) || s.employee?.id === row.outgoingId)
    )
  }
  const setSeedOutgoing = (idx, outgoingId) =>
    setSeedRows((rows) => rows.map((r, i) => (i === idx ? { ...r, outgoingId } : r)))

  // Read-only label for a retry's locked outgoing (the original employee relieved).
  const lockedOutgoingLabel = (id) => {
    const s = offshore.find((x) => x.employee?.id === id)
    if (!s) return '—'
    return `${s.employee.full_name} — ${s.installation?.name ?? '—'} · ${daysInclusive(s.sign_on_date)}d`
  }

  const removeItem = (i) => setItems((list) => list.filter((_, idx) => idx !== i))

  // Final line items = seed rows that have an outgoing assigned + ad-hoc picker items.
  const seedItems = seedRows
    .filter((r) => r.outgoingId)
    .map((r) => ({ employeeId: r.incomingId, replacingEmployeeId: r.outgoingId }))
  const allItems = [...seedItems, ...items]
  const canCreate = installationId && requestDate && allItems.length > 0 && !busy

  async function create() {
    setBusy(true)
    setError('')
    const { error: err } = await createManifestRequest(
      { installationId, requestDate, notes, requestedBy: userId },
      allItems
    )
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onCreated()
  }

  return (
    <Modal
      open={open}
      title={
        seeded
          ? mode === 'retry'
            ? 'Create retry request'
            : 'Create manifest request'
          : 'New manifest request'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canCreate} onClick={create}>
            {busy ? 'Creating…' : `Create request${allItems.length ? ` (${allItems.length})` : ''}`}
          </button>
        </>
      }
    >
      <div className="board-controls">
        <label className="field">
          <span>Installation *</span>
          <select value={installationId} onChange={(e) => setInstallationId(e.target.value)}>
            <option value="">Select…</option>
            {installations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.type})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Request date *</span>
          <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {seeded && (
        <>
          <h3 className="section-heading">Sending ({seedRows.length})</h3>
          {!installationId && (
            <p className="muted">Pick an installation to choose who each person relieves.</p>
          )}
          <ul className="card-list">
            {seedRows.map((r, i) => {
              const opts = r.locked ? [] : outgoingOptionsFor(r)
              return (
                <li key={r.incomingId}>
                  <div className="roster-card roster-card--col">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{r.incomingName}</span>
                      <span className="emp-card__meta">{r.designationName} · relieving…</span>
                    </div>
                    {r.locked ? (
                      <p className="field-readonly">
                        Replacing <strong>{lockedOutgoingLabel(r.outgoingId)}</strong> · original
                        pairing
                      </p>
                    ) : (
                      <>
                        <label className="field">
                          <span>Replacing (offshore here)</span>
                          <select
                            value={r.outgoingId}
                            onChange={(e) => setSeedOutgoing(i, e.target.value)}
                            disabled={!installationId}
                          >
                            <option value="">— select who they relieve —</option>
                            {opts.map((s) => (
                              <option key={s.id} value={s.employee.id}>
                                {s.employee.full_name} — {s.employee.designation?.name ?? '—'} (
                                {daysInclusive(s.sign_on_date)}d)
                              </option>
                            ))}
                          </select>
                        </label>
                        {installationId && opts.length === 0 && r.outgoingId === '' && (
                          <span className="reserve-sub reserve-sub--block">
                            No offshore employee here this person can relieve.
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {items.length > 0 && (
        <>
          <h3 className="section-heading">Line items ({items.length})</h3>
          <ul className="card-list">
            {items.map((it, i) => (
              <li key={i}>
                <div className="roster-card">
                  <div className="emp-card__main">
                    <span className="emp-card__name">{nameById.get(it.employeeId) ?? '—'}</span>
                    <span className="emp-card__meta">
                      {it.replacingEmployeeId
                        ? `replacing ${nameById.get(it.replacingEmployeeId) ?? '—'}`
                        : it.reason || 'no direct replacement'}
                      {it.isEmergencyException ? ' · ⚠ emergency exception' : ''}
                    </span>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeItem(i)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {installationId && (
        <>
          <h3 className="section-heading">Add line item</h3>
          <LineItemPicker
            installationId={installationId}
            candidates={candidates}
            designations={designations}
            requirements={requirements}
            offshore={offshore}
            thresholds={thresholds}
            usedIds={usedIds}
            onAdd={(item) => setItems((list) => [...list, item])}
          />
        </>
      )}

      {error && <p className="banner banner--error">{error}</p>}
    </Modal>
  )
}
