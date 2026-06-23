import { useEffect, useState } from 'react'
import Modal from './Modal'
import { isDeprioritised, createCall, setCallOutcome, listCallLog } from '../lib/reserve'
import { daysInclusive, daysBetween, todayISO } from '../lib/dates'

const OUTCOME_LABEL = {
  no_answer: 'No answer',
  call_back: 'Call back',
  confirmed: 'Confirmed',
  declined: 'Declined',
  unreachable: 'Unreachable',
}

// Model A outcome buttons, in display order.
const CALL_OUTCOMES = [
  ['confirmed', 'Confirmed'],
  ['declined', 'Declined'],
  ['call_back', 'Call back'],
  ['no_answer', 'No answer'],
  ['unreachable', 'Unreachable'],
]

const OUTCOME_PILL = {
  confirmed: 'pill--ok',
  declined: 'pill--bad',
  call_back: 'pill--warn',
  no_answer: 'pill--muted',
  unreachable: 'pill--muted',
}

function callSummary(av) {
  const n = av?.call_count ?? 0
  const base = `📞 ${n} call${n === 1 ? '' : 's'}`
  if (!av?.last_call_outcome) return `${base} · not called`
  const when = av.last_call_at ? ` (${av.last_call_at.slice(0, 10)})` : ''
  return `${base} · last: ${OUTCOME_LABEL[av.last_call_outcome] ?? av.last_call_outcome}${when}`
}

const restLabel = (c) => (c.restDays === null ? 'No prior offshore' : `${c.restDays}d rest`)

// Bottom sheet launched from an Offshore roster card. Replaces the old
// standalone Replacement Finder: pick is the target, the body shows who is
// confirmed-ready, who can be called, and who is blocked — all for the
// target's designation. Call/Confirm actions are handled by the parent.
export default function ReplaceSheet({
  open,
  target,
  targetState,
  deadline,
  userId,
  groups,
  flash,
  error,
  onManifest,
  onChanged,
  onClose,
}) {
  // Inline "Manifest" quick-action state (one open form at a time).
  const [manifestForId, setManifestForId] = useState(null)
  const [manifestDate, setManifestDate] = useState(todayISO())
  const [manifestBusy, setManifestBusy] = useState(false)
  const [manifestErr, setManifestErr] = useState('')
  const [manifestOkFor, setManifestOkFor] = useState(null)

  // Model A inline call flow (one open at a time): tap Call… -> create a call_log
  // row immediately -> pick an outcome -> (if confirmed) capture commitment info.
  const [callRowFor, setCallRowFor] = useState(null) // candidate id
  const [callId, setCallId] = useState(null) // the created call_log row
  const [callBusy, setCallBusy] = useState(false)
  const [callErr, setCallErr] = useState('')
  const [confirmExtras, setConfirmExtras] = useState(false)
  const [cDate, setCDate] = useState(todayISO())
  const [cHometown, setCHometown] = useState('')
  const [cTravel, setCTravel] = useState('')

  // "Check history" collapsible (one open at a time).
  const [historyFor, setHistoryFor] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Reset all inline UI whenever the sheet targets a different stint.
  useEffect(() => {
    setManifestForId(null)
    setManifestOkFor(null)
    setManifestErr('')
    setManifestDate(todayISO())
    setCallRowFor(null)
    setCallId(null)
    setCallErr(null)
    setConfirmExtras(false)
    setHistoryFor(null)
    setHistoryRows([])
  }, [target?.id])

  if (!open || !target) return null

  const days = daysInclusive(target.sign_on_date)
  const dl = deadline || target.expected_rotation_date
  const { confirmed = [], available = [], blocked = [] } = groups ?? {}
  const designationName = target.employee?.designation?.name ?? ''

  // Deadline status relative to today: overdue (red) / today (red) / remaining
  // (amber). The date itself is kept as a muted sub-label for reference.
  let deadlineLabel = null
  let deadlineCls = ''
  if (dl) {
    const diff = daysBetween(todayISO(), dl) // >0 future, 0 today, <0 past
    if (diff > 0) {
      deadlineLabel = `${diff} day${diff === 1 ? '' : 's'} remaining`
      deadlineCls = 'pill--warn'
    } else if (diff === 0) {
      deadlineLabel = 'Deadline today'
      deadlineCls = 'pill--bad'
    } else {
      const over = -diff
      deadlineLabel = `${over} day${over === 1 ? '' : 's'} overdue`
      deadlineCls = 'pill--bad'
    }
  }

  function openManifest(c) {
    setManifestForId(c.id)
    setManifestOkFor(null)
    setManifestDate(todayISO())
    setManifestErr('')
  }
  function cancelManifest() {
    setManifestForId(null)
    setManifestErr('')
  }
  async function submitManifest(c) {
    setManifestBusy(true)
    setManifestErr('')
    const { error: err } = await onManifest({ candidate: c, requestDate: manifestDate })
    setManifestBusy(false)
    if (err) {
      setManifestErr(err.message)
      return
    }
    setManifestForId(null)
    setManifestOkFor(c.id)
  }

  // The Manifest button (alongside Call/Confirm) for a confirmed/available row.
  const manifestBtn = (c) => (
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => openManifest(c)}>
      Manifest…
    </button>
  )
  // The expandable panel below the row: success note, the mini-form, or nothing.
  const manifestPanel = (c) => {
    if (manifestOkFor === c.id) {
      return <p className="cand-manifest__ok">✅ Manifest request created</p>
    }
    if (manifestForId !== c.id) return null
    return (
      <div className="cand-manifest">
        <label className="field field--inline">
          <span>Request date</span>
          <input
            type="date"
            value={manifestDate}
            onChange={(e) => setManifestDate(e.target.value)}
          />
        </label>
        {manifestErr && <p className="banner banner--error">{manifestErr}</p>}
        <div className="cand-manifest__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={cancelManifest}
            disabled={manifestBusy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => submitManifest(c)}
            disabled={manifestBusy || !manifestDate}
          >
            {manifestBusy ? 'Submitting…' : 'Submit manifest request'}
          </button>
        </div>
      </div>
    )
  }

  // --- Model A call flow ---
  async function startCall(c) {
    setCallRowFor(c.id)
    setConfirmExtras(false)
    setCallErr('')
    setCDate(todayISO())
    setCHometown('')
    setCTravel('')
    setCallId(null)
    setCallBusy(true)
    const { id, error: err } = await createCall(c.id, { userId })
    setCallBusy(false)
    if (err) {
      setCallErr(err.message)
      return
    }
    setCallId(id)
  }
  function cancelCall() {
    setCallRowFor(null)
    setCallId(null)
    setConfirmExtras(false)
    setCallErr('')
  }
  async function saveOutcome(c, outcome, extras) {
    if (!callId) return
    setCallBusy(true)
    setCallErr('')
    const { error: err } = await setCallOutcome(callId, c.id, outcome, { ...extras, userId })
    setCallBusy(false)
    if (err) {
      setCallErr(err.message)
      return
    }
    cancelCall()
    onChanged?.()
  }
  function pickOutcome(c, outcome) {
    // 'confirmed' opens the optional commitment fields; the rest save at once.
    if (outcome === 'confirmed') {
      setConfirmExtras(true)
      return
    }
    saveOutcome(c, outcome, {})
  }
  const saveConfirmed = (c) =>
    saveOutcome(c, 'confirmed', {
      commitmentDate: cDate || null,
      hometown: cHometown,
      travelDays: cTravel,
    })

  // The inline outcome row beneath a candidate card.
  const callFlow = (c) => {
    if (callRowFor !== c.id) return null
    return (
      <div className="call-flow">
        {callErr && <p className="banner banner--error">{callErr}</p>}
        {callBusy && !callId && <p className="muted">Logging call…</p>}
        {!confirmExtras ? (
          <div className="outcome-grid">
            {CALL_OUTCOMES.map(([val, label]) => (
              <button
                key={val}
                type="button"
                className="outcome-btn"
                disabled={callBusy || !callId}
                onClick={() => pickOutcome(c, val)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="call-confirm">
            <label className="field field--inline">
              <span>Commitment date</span>
              <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
            </label>
            <label className="field field--inline">
              <span>Hometown</span>
              <input value={cHometown} onChange={(e) => setCHometown(e.target.value)} />
            </label>
            <label className="field field--inline">
              <span>Travel days</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={cTravel}
                onChange={(e) => setCTravel(e.target.value)}
              />
            </label>
            <div className="cand-manifest__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={cancelCall}
                disabled={callBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => saveConfirmed(c)}
                disabled={callBusy}
              >
                {callBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
        {!confirmExtras && (
          <button
            type="button"
            className="linkish call-flow__cancel"
            onClick={cancelCall}
            disabled={callBusy}
          >
            Cancel
          </button>
        )}
      </div>
    )
  }

  // --- Check history ---
  async function toggleHistory(c) {
    if (historyFor === c.id) {
      setHistoryFor(null)
      return
    }
    setHistoryFor(c.id)
    setHistoryRows([])
    setHistoryLoading(true)
    const { data, error: err } = await listCallLog(c.id)
    setHistoryLoading(false)
    if (!err) setHistoryRows(data ?? [])
  }
  const historyToggle = (c) => (
    <button type="button" className="linkish call-history__toggle" onClick={() => toggleHistory(c)}>
      Call history ({c.availability?.call_count ?? 0})
    </button>
  )
  const historyPanel = (c) => {
    if (historyFor !== c.id) return null
    if (historyLoading) return <p className="muted call-history">Loading…</p>
    if (historyRows.length === 0) return <p className="muted call-history">No calls logged yet.</p>
    return (
      <ul className="call-history">
        {historyRows.map((r) => (
          <li key={r.id} className="call-history__row">
            <span className="call-history__date">{r.called_at?.slice(0, 10)}</span>
            <span className={`pill ${OUTCOME_PILL[r.outcome] ?? 'pill--muted'}`}>
              {OUTCOME_LABEL[r.outcome] ?? r.outcome ?? 'No outcome'}
            </span>
            {r.commitment_date && <span className="muted">→ {r.commitment_date}</span>}
            {r.hometown && <span className="muted">· {r.hometown}</span>}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Modal open={open} title="Find replacement" onClose={onClose}>
      <div className={`target-card ${targetState?.cls ?? ''}`}>
        <div className="target-card__top">
          <div>
            <span className="emp-card__name">{target.employee?.full_name}</span>
            <span className="emp-card__meta">
              {target.employee?.emp_id} · {designationName} · 📍 {target.installation?.name}
            </span>
          </div>
          {targetState?.label && <span className={`pill ${targetState.cls}`}>{targetState.label}</span>}
        </div>
        <div className="target-card__stats">
          <span>
            <strong>{days}</strong> days served
          </span>
        </div>
        {deadlineLabel && (
          <div className="target-card__deadline">
            <span className={`pill ${deadlineCls}`}>{deadlineLabel}</span>
            <span className="reserve-sub">Rotation deadline: {dl}</span>
          </div>
        )}
      </div>

      {flash && <p className="banner banner--info">{flash}</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {/* Confirmed ready */}
      {confirmed.length > 0 && (
        <>
          <h3 className="section-heading">✅ Confirmed ready ({confirmed.length})</h3>
          <ul className="card-list">
            {confirmed.map((c) => {
              const exp = c.availability?.expires_at?.slice(0, 10)
              return (
                <li key={c.id}>
                  <div className="cand-card">
                    <div className="cand-card__head">
                      <div className="emp-card__main">
                        <span className="emp-card__name">{c.full_name}</span>
                        <span className="emp-card__meta">
                          {c.emp_id} · {restLabel(c)}
                        </span>
                      </div>
                      <span className="pill pill--ok">Confirmed</span>
                    </div>
                    <div className="cand-card__calls muted">
                      {callSummary(c.availability)}
                      {exp ? ` · valid until ${exp}` : ''}
                    </div>
                    <div className="cand-card__actions">{manifestBtn(c)}</div>
                    {manifestPanel(c)}
                    {historyToggle(c)}
                    {historyPanel(c)}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* Available to call */}
      <h3 className="section-heading">📞 Available to call ({available.length})</h3>
      {available.length === 0 ? (
        <p className="muted empty-state">
          No eligible base staff who can fill the {designationName} role on base.
        </p>
      ) : (
        <ul className="card-list">
          {available.map((c) => {
            const dim = isDeprioritised(c)
            return (
              <li key={c.id}>
                <div className={'cand-card' + (dim ? ' cand-card--dim' : '')}>
                  <div className="cand-card__head">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{c.full_name}</span>
                      <span className="emp-card__meta">
                        {c.emp_id} · {c.designation?.name ?? '—'} · {restLabel(c)}
                      </span>
                    </div>
                    <span className="pill pill--ok">Certs OK</span>
                  </div>
                  <div className="cand-card__calls muted">
                    {callSummary(c.availability)}
                    {dim && ' · repeated no-answer'}
                  </div>
                  <div className="cand-card__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => startCall(c)}
                      disabled={callRowFor === c.id}
                    >
                      Call…
                    </button>
                    {manifestBtn(c)}
                  </div>
                  {callFlow(c)}
                  {manifestPanel(c)}
                  {historyToggle(c)}
                  {historyPanel(c)}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Blocked */}
      {blocked.length > 0 && (
        <>
          <h3 className="section-heading">🚫 Not available ({blocked.length})</h3>
          <ul className="card-list">
            {blocked.map((c) => (
              <li key={c.id}>
                <div className="cand-card cand-card--dim">
                  <div className="cand-card__head">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{c.full_name}</span>
                      <span className="emp-card__meta">
                        {c.emp_id} · {c.designation?.name ?? '—'} · {restLabel(c)}
                      </span>
                    </div>
                    <span className="pill pill--bad">{c.status?.label}</span>
                  </div>
                  <div className="cand-card__calls muted">{c.status?.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
