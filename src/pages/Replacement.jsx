import { useEffect, useMemo, useState } from 'react'
import { listOffshoreStints } from '../lib/boarding'
import { loadCandidates, rankReplacementCandidates, isDeprioritised, logCall } from '../lib/reserve'
import { rotationState } from '../lib/rotation'
import { daysInclusive, addDays, todayISO } from '../lib/dates'
import { useAuth } from '../context/AuthContext'
import CallDialog from '../components/CallDialog'

const OUTCOME_LABEL = {
  no_answer: 'No answer',
  call_back: 'Call back',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

export default function Replacement() {
  const { user } = useAuth()
  const [stints, setStints] = useState([])
  const [candidates, setCandidates] = useState([])
  const [validityDays, setValidityDays] = useState(14)
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [targetId, setTargetId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [callFor, setCallFor] = useState(null)
  const [flash, setFlash] = useState('')

  async function load(keepTarget = true) {
    setLoading(true)
    const [stintRes, candRes] = await Promise.all([listOffshoreStints(), loadCandidates()])
    if (stintRes.error || candRes.error) {
      setError((stintRes.error || candRes.error).message)
      setLoading(false)
      return
    }
    const sorted = [...(stintRes.data ?? [])].sort(
      (a, b) => daysInclusive(b.sign_on_date) - daysInclusive(a.sign_on_date)
    )
    setStints(sorted)
    setCandidates(candRes.candidates)
    setValidityDays(candRes.confirmationValidityDays)
    setThresholds(candRes.thresholds)
    // Default the target to the person furthest over (top of the sorted list).
    setTargetId((cur) => (keepTarget && cur ? cur : sorted[0]?.id ?? ''))
    setLoading(false)
  }

  useEffect(() => {
    load(false)
  }, [])

  const target = useMemo(() => stints.find((s) => s.id === targetId) ?? null, [stints, targetId])
  const targetDays = target ? daysInclusive(target.sign_on_date) : 0
  const targetState = target ? rotationState(targetDays, thresholds) : null
  const deadline = target
    ? target.expected_rotation_date || addDays(target.sign_on_date, thresholds.max)
    : null

  const ranked = useMemo(() => {
    if (!target?.employee?.designation?.id) return []
    return rankReplacementCandidates(candidates, target.employee.designation.id)
  }, [candidates, target])

  async function doConfirm(c) {
    setFlash('')
    const { error: err } = await logCall(c.id, 'confirmed', {
      userId: user?.id,
      confirmationValidityDays: validityDays,
      confirmedForDate: deadline,
    })
    if (err) setError(err.message)
    else {
      setFlash(`${c.full_name} confirmed (valid ${validityDays} days).`)
      load()
    }
  }

  async function handleLogCall(outcome, notes) {
    const c = callFor
    setCallFor(null)
    setFlash('')
    const { error: err } = await logCall(c.id, outcome, {
      notes,
      userId: user?.id,
      confirmationValidityDays: validityDays,
      confirmedForDate: outcome === 'confirmed' ? deadline : undefined,
    })
    if (err) setError(err.message)
    else {
      setFlash(`Logged "${OUTCOME_LABEL[outcome]}" for ${c.full_name}.`)
      load()
    }
  }

  if (loading) return <p className="muted">Loading…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  return (
    <section>
      {stints.length === 0 ? (
        <p className="muted empty-state">Nobody is offshore to replace yet.</p>
      ) : (
        <>
          <label className="field">
            <span>Who needs replacing?</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {stints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.employee?.full_name} — {s.employee?.designation?.name} @ {s.installation?.name} (
                  {daysInclusive(s.sign_on_date)}d)
                </option>
              ))}
            </select>
          </label>

          {target && (
            <div className={`target-card ${targetState.cls}`}>
              <div className="target-card__top">
                <div>
                  <span className="emp-card__name">{target.employee?.full_name}</span>
                  <span className="emp-card__meta">
                    {target.employee?.emp_id} · {target.employee?.designation?.name} · 📍{' '}
                    {target.installation?.name}
                  </span>
                </div>
                <span className={`pill ${targetState.cls}`}>{targetState.label}</span>
              </div>
              <div className="target-card__stats">
                <span>
                  <strong>{targetDays}</strong> days served
                </span>
                <span>
                  Rotation deadline: <strong>{deadline}</strong>
                </span>
              </div>
            </div>
          )}

          {flash && <p className="banner banner--info">{flash}</p>}

          <h3 className="section-heading">
            Candidates — {target?.employee?.designation?.name ?? ''} ({ranked.length})
          </h3>
          {ranked.length === 0 ? (
            <p className="muted empty-state">
              No eligible, cert-current base staff of this designation.
            </p>
          ) : (
            <ul className="card-list">
              {ranked.map((c) => {
                const av = c.availability
                const dim = isDeprioritised(c)
                return (
                  <li key={c.id}>
                    <div className={'cand-card' + (dim ? ' cand-card--dim' : '')}>
                      <div className="cand-card__head">
                        <div className="emp-card__main">
                          <span className="emp-card__name">
                            {c.full_name}
                            {c.liveConfirmed && <span className="pill pill--ok cand-confirmed">Confirmed</span>}
                          </span>
                          <span className="emp-card__meta">
                            {c.emp_id} · {c.restDays === null ? 'no prior offshore' : `${c.restDays}d rest`}
                          </span>
                        </div>
                        <span className="pill pill--ok">Certs OK</span>
                      </div>

                      <div className="cand-card__calls muted">
                        📞 {av?.call_count ?? 0} call{(av?.call_count ?? 0) === 1 ? '' : 's'}
                        {av?.last_call_outcome ? ` · last: ${OUTCOME_LABEL[av.last_call_outcome]}` : ' · not called'}
                        {av?.last_call_at ? ` (${av.last_call_at.slice(0, 10)})` : ''}
                        {dim && ' · repeated no-answer'}
                      </div>

                      <div className="cand-card__actions">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCallFor(c)}>
                          Call…
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => doConfirm(c)}
                          disabled={c.liveConfirmed}
                        >
                          {c.liveConfirmed ? 'Confirmed' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <CallDialog
        open={Boolean(callFor)}
        candidate={callFor}
        onClose={() => setCallFor(null)}
        onLog={handleLogCall}
      />
    </section>
  )
}
