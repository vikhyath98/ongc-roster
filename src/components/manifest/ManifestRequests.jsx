import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listManifestRequests, updateManifestRequestStatus, createManifestRequest } from '../../lib/manifest'
import { loadCandidates } from '../../lib/reserve'
import { listInstallations, listDesignations } from '../../lib/reference'
import { listInstallationRequirements } from '../../lib/configAdmin'
import { listOffshoreStints } from '../../lib/boarding'
import { todayISO, daysInclusive } from '../../lib/dates'
import Modal from '../Modal'

const STATUS_LABEL = {
  sent: 'Sent',
  partially_approved: 'Partially approved',
  approved: 'Approved',
  rejected: 'Rejected',
}
const STATUS_ORDER = ['sent', 'partially_approved', 'approved', 'rejected']

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

  async function setStatus(id, status) {
    const { error: err } = await updateManifestRequestStatus(id, status)
    if (err) setError(err.message)
    else load()
  }

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
              <div className="roster-card roster-card--col">
                <div className="roster-card__row">
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
                </div>
                <label className="field manifest-status-edit">
                  <span className="muted">Status</span>
                  <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}>
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
    </div>
  )
}

function NewRequestModal({
  open,
  userId,
  installations,
  candidates,
  requirements,
  designations,
  offshore,
  thresholds,
  onClose,
  onCreated,
}) {
  const [installationId, setInstallationId] = useState('')
  const [requestDate, setRequestDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Add-line-item sub-form.
  const [incomingId, setIncomingId] = useState('')
  const [replacingId, setReplacingId] = useState('')
  const [itemReason, setItemReason] = useState('')
  const [emergencyOn, setEmergencyOn] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')

  // Reset everything when (re)opened.
  useEffect(() => {
    if (!open) return
    setInstallationId('')
    setRequestDate(todayISO())
    setNotes('')
    setItems([])
    setBusy(false)
    setError('')
    resetSubForm()
  }, [open])

  function resetSubForm() {
    setIncomingId('')
    setReplacingId('')
    setItemReason('')
    setEmergencyOn(false)
    setExceptionReason('')
  }

  const desigName = useMemo(() => new Map(designations.map((d) => [d.id, d.name])), [designations])

  // Designations this installation needs (from requirements). Empty = no
  // requirements configured, in which case all confirmed staff are eligible.
  const relevantDesigIds = useMemo(() => {
    const s = new Set()
    for (const r of requirements) if (r.installation_id === installationId) s.add(r.designation_id)
    return s
  }, [requirements, installationId])

  // Confirmed + unexpired base staff for the relevant designations. Hard
  // restriction — unconfirmed candidates never appear.
  const confirmedCandidates = useMemo(() => {
    return candidates.filter(
      (c) =>
        c.employment_status === 'active' &&
        c.liveConfirmed &&
        (relevantDesigIds.size === 0 || relevantDesigIds.has(c.designation_id))
    )
  }, [candidates, relevantDesigIds])

  // Relevant designations that currently have zero confirmed candidates.
  const missingDesigs = useMemo(() => {
    if (relevantDesigIds.size === 0) return []
    const have = new Set(confirmedCandidates.map((c) => c.designation_id))
    return [...relevantDesigIds].filter((id) => !have.has(id)).map((id) => desigName.get(id) ?? '—')
  }, [relevantDesigIds, confirmedCandidates, desigName])

  // Offshore employees at this installation, available as the relieved party.
  const offshoreHere = useMemo(
    () => offshore.filter((s) => s.installation_id === installationId),
    [offshore, installationId]
  )

  // replacingId holds the OUTGOING EMPLOYEE id (not the stint id) — match by it.
  const replacingStint = offshoreHere.find((s) => s.employee?.id === replacingId) ?? null
  const replacingDays = replacingStint ? daysInclusive(replacingStint.sign_on_date) : null
  const under56 = replacingDays != null && replacingDays < thresholds.min
  const warn65 = replacingDays != null && replacingDays >= thresholds.warning

  // Category per designation, to enforce like-for-like replacement.
  const catByDesig = useMemo(
    () => new Map(designations.map((d) => [d.id, d.category?.name])),
    [designations]
  )

  // Employees already used (incoming or outgoing) in staged items, to drop
  // them from both pickers for subsequent line items.
  const usedIds = useMemo(() => {
    const s = new Set()
    for (const it of items) {
      s.add(it.employeeId)
      if (it.replacingEmployeeId) s.add(it.replacingEmployeeId)
    }
    return s
  }, [items])

  const incoming = candidates.find((c) => c.id === incomingId) ?? null
  const incomingDesig = incoming?.designation
  const outgoingDesig = replacingStint?.employee?.designation

  // Designation matching: exact match passes silently; a different designation
  // in the SAME Unskilled category warns (non-blocking); anything else is a
  // hard block (Skilled / Semi-skilled / Outsourced must match exactly).
  let desigBlock = null
  let desigWarn = null
  if (incoming && replacingStint && incomingDesig?.id && outgoingDesig?.id) {
    if (incomingDesig.id !== outgoingDesig.id) {
      const inCat = catByDesig.get(incomingDesig.id)
      const outCat = catByDesig.get(outgoingDesig.id)
      if (inCat && inCat === outCat && outCat === 'Unskilled') {
        desigWarn = `⚠️ ${incomingDesig.name} is replacing ${outgoingDesig.name} — different roles, please confirm this is intended.`
      } else {
        desigBlock = `${outgoingDesig.name} can only be replaced by another ${outgoingDesig.name}.`
      }
    }
  }

  // Name lookups for the staged-items display.
  const nameById = useMemo(() => {
    const m = new Map()
    for (const c of candidates) m.set(c.id, c.full_name)
    for (const s of offshore) if (s.employee) m.set(s.employee.id, s.employee.full_name)
    return m
  }, [candidates, offshore])

  const canAddItem =
    Boolean(incomingId) &&
    !desigBlock &&
    (!replacingId || !under56 || (emergencyOn && exceptionReason.trim().length > 0))

  function addItem() {
    if (!canAddItem) return
    const isException = Boolean(replacingId) && under56 && emergencyOn
    setItems((list) => [
      ...list,
      {
        employeeId: incomingId,
        replacingEmployeeId: replacingId || null,
        reason: replacingId ? null : itemReason.trim() || null,
        isEmergencyException: isException,
        exceptionReason: isException ? exceptionReason.trim() : null,
      },
    ])
    resetSubForm()
  }

  const removeItem = (i) => setItems((list) => list.filter((_, idx) => idx !== i))

  const canCreate = installationId && requestDate && items.length > 0 && !busy

  async function create() {
    setBusy(true)
    setError('')
    const { error: err } = await createManifestRequest(
      { installationId, requestDate, notes, requestedBy: userId },
      items
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
      title="New manifest request"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canCreate} onClick={create}>
            {busy ? 'Creating…' : `Create request${items.length ? ` (${items.length})` : ''}`}
          </button>
        </>
      }
    >
      <div className="board-controls">
        <label className="field">
          <span>Installation *</span>
          <select
            value={installationId}
            onChange={(e) => {
              setInstallationId(e.target.value)
              resetSubForm()
            }}
          >
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

      {/* Staged line items */}
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

      {/* Add a line item */}
      {installationId && (
        <>
          <h3 className="section-heading">Add line item</h3>

          {missingDesigs.length > 0 && (
            <p className="banner banner--warn">
              No confirmed {missingDesigs.join(', ')} candidate
              {missingDesigs.length === 1 ? '' : 's'} available. Confirm availability first —{' '}
              <Link to="/roster?tab=base&confirm=unconfirmed">go to Base staff</Link>.
            </p>
          )}

          <label className="field">
            <span>Incoming / relief employee * (confirmed only)</span>
            <select value={incomingId} onChange={(e) => setIncomingId(e.target.value)}>
              <option value="">Select…</option>
              {confirmedCandidates
                .filter((c) => !usedIds.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} — {c.designation?.name ?? '—'}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            <span>Replacing (offshore here, optional)</span>
            <select
              value={replacingId}
              onChange={(e) => {
                setReplacingId(e.target.value)
                setEmergencyOn(false)
                setExceptionReason('')
              }}
            >
              <option value="">— not a direct replacement —</option>
              {offshoreHere
                .filter((s) => !usedIds.has(s.employee?.id))
                .map((s) => (
                  <option key={s.id} value={s.employee?.id}>
                    {s.employee?.full_name} — {s.employee?.designation?.name ?? '—'} (
                    {daysInclusive(s.sign_on_date)}d)
                  </option>
                ))}
            </select>
          </label>

          {desigBlock && <p className="banner banner--error">{desigBlock}</p>}
          {desigWarn && <p className="banner banner--warn">{desigWarn}</p>}

          {!replacingId && (
            <label className="field">
              <span>Reason (optional)</span>
              <input value={itemReason} onChange={(e) => setItemReason(e.target.value)} />
            </label>
          )}

          {/* Day-56 gate */}
          {under56 && (
            <div className="banner banner--error">
              <p style={{ margin: 0 }}>
                Cannot request a replacement for {replacingStint.employee?.full_name} — only{' '}
                {replacingDays} days served. Manifesting before day {thresholds.min} risks an
                understay penalty.
              </p>
              <label className="checkrow" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={emergencyOn}
                  onChange={(e) => setEmergencyOn(e.target.checked)}
                />
                <span>Emergency exception</span>
              </label>
              {emergencyOn && (
                <label className="field" style={{ marginTop: 8 }}>
                  <span>Exception reason *</span>
                  <textarea
                    rows={2}
                    value={exceptionReason}
                    onChange={(e) => setExceptionReason(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}

          {/* Day-65 warning (non-blocking) */}
          {warn65 && (
            <p className="banner banner--warn">
              This employee is on day {replacingDays} — the safe manifesting window (day{' '}
              {thresholds.min}–{thresholds.warning}) has closed. Any resulting overstay is likely to
              default toward SKFS responsibility.
            </p>
          )}

          <button
            type="button"
            className="btn btn--ghost"
            disabled={!canAddItem}
            onClick={addItem}
            style={{ marginTop: 10 }}
          >
            ＋ Add line item
          </button>
        </>
      )}

      {error && <p className="banner banner--error">{error}</p>}
    </Modal>
  )
}
