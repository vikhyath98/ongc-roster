import { useEffect, useMemo, useState } from 'react'
import { listOffshoreStints } from '../lib/boarding'
import { loadCandidates, logCall, candidateStatus, splitReplacementGroups } from '../lib/reserve'
import { daysInclusive, addDays } from '../lib/dates'
import { rotationState } from '../lib/rotation'
import { useAuth } from '../context/AuthContext'
import ReplaceSheet from '../components/ReplaceSheet'
import CallDialog from '../components/CallDialog'

const OUTCOME_LABEL = {
  no_answer: 'No answer',
  call_back: 'Call back',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

// The Roster is the operational hub. Two tabs:
//   Offshore  — who is deployed, grouped by installation, with a per-card
//               "Find replacement" action once they reach min_service_days.
//   Base staff — everyone on base (the reserve pool), with rest / eligibility /
//               confirmation at a glance.
export default function Roster() {
  const { user } = useAuth()
  const [tab, setTab] = useState('offshore')
  const [stints, setStints] = useState([])
  const [candidates, setCandidates] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [validityDays, setValidityDays] = useState(14)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Offshore-tab filters.
  const [fInstall, setFInstall] = useState('')
  const [fDesig, setFDesig] = useState('')
  // Base-tab filter.
  const [fBaseDesig, setFBaseDesig] = useState('')

  // Replacement sheet + call dialog.
  const [replaceForId, setReplaceForId] = useState(null)
  const [callFor, setCallFor] = useState(null)
  const [flash, setFlash] = useState('')
  const [sheetError, setSheetError] = useState('')

  async function load() {
    setLoading(true)
    const [stintRes, candRes] = await Promise.all([listOffshoreStints(), loadCandidates()])
    if (stintRes.error || candRes.error) {
      setError((stintRes.error || candRes.error).message)
      setLoading(false)
      return
    }
    setStints(stintRes.data ?? [])
    setCandidates(candRes.candidates ?? [])
    setThresholds(candRes.thresholds)
    setValidityDays(candRes.confirmationValidityDays)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // ----- Offshore tab: decorate, filter, group by installation -----
  const installOptions = useMemo(() => {
    const m = new Map()
    for (const s of stints) if (s.installation) m.set(s.installation.id, s.installation)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [stints])

  const offshoreDesigOptions = useMemo(() => {
    const m = new Map()
    for (const s of stints)
      if (s.employee?.designation) m.set(s.employee.designation.id, s.employee.designation)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [stints])

  const groups = useMemo(() => {
    const decorated = stints
      .filter((s) => !fInstall || s.installation_id === fInstall)
      .filter((s) => !fDesig || s.employee?.designation?.id === fDesig)
      .map((s) => {
        const days = daysInclusive(s.sign_on_date)
        return { ...s, days, state: rotationState(days, thresholds) }
      })
    const byInstall = new Map()
    for (const s of decorated) {
      const key = s.installation?.id ?? 'unknown'
      if (!byInstall.has(key)) byInstall.set(key, { installation: s.installation, people: [] })
      byInstall.get(key).people.push(s)
    }
    const list = [...byInstall.values()]
    list.sort((a, b) => (a.installation?.name ?? '').localeCompare(b.installation?.name ?? ''))
    for (const g of list) g.people.sort((a, b) => b.days - a.days)
    return list
  }, [stints, thresholds, fInstall, fDesig])

  const total = stints.length
  const shown = groups.reduce((n, g) => n + g.people.length, 0)
  const filtered = Boolean(fInstall || fDesig)

  // ----- Base tab: active on-base staff (the reserve pool) -----
  const baseStaff = useMemo(
    () => candidates.filter((c) => c.employment_status === 'active'),
    [candidates]
  )
  const baseDesigOptions = useMemo(() => {
    const m = new Map()
    for (const c of baseStaff) if (c.designation) m.set(c.designation.id, c.designation)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [baseStaff])
  const baseShown = useMemo(
    () => (fBaseDesig ? baseStaff.filter((c) => c.designation_id === fBaseDesig) : baseStaff),
    [baseStaff, fBaseDesig]
  )

  // ----- Replacement sheet -----
  const target = useMemo(
    () => stints.find((s) => s.id === replaceForId) ?? null,
    [stints, replaceForId]
  )
  const targetState = target
    ? rotationState(daysInclusive(target.sign_on_date), thresholds)
    : null
  const replaceGroups = useMemo(
    () =>
      target?.employee?.designation?.id
        ? splitReplacementGroups(candidates, target.employee.designation.id)
        : null,
    [candidates, target]
  )

  function openReplace(stintId) {
    setReplaceForId(stintId)
    setFlash('')
    setSheetError('')
  }
  function closeReplace() {
    setReplaceForId(null)
    setCallFor(null)
    setFlash('')
    setSheetError('')
  }

  const deadlineFor = (t) =>
    t.expected_rotation_date || addDays(t.sign_on_date, thresholds.max)

  async function doConfirm(c) {
    setFlash('')
    setSheetError('')
    const { error: err } = await logCall(c.id, 'confirmed', {
      userId: user?.id,
      confirmationValidityDays: validityDays,
      confirmedForDate: target ? deadlineFor(target) : undefined,
    })
    if (err) setSheetError(err.message)
    else {
      setFlash(`${c.full_name} confirmed (valid ${validityDays} days).`)
      await load()
    }
  }

  async function handleLogCall(outcome, notes) {
    const c = callFor
    setCallFor(null)
    setFlash('')
    setSheetError('')
    const { error: err } = await logCall(c.id, outcome, {
      notes,
      userId: user?.id,
      confirmationValidityDays: validityDays,
      confirmedForDate: outcome === 'confirmed' && target ? deadlineFor(target) : undefined,
    })
    if (err) setSheetError(err.message)
    else {
      setFlash(`Logged "${OUTCOME_LABEL[outcome] ?? outcome}" for ${c.full_name}.`)
      await load()
    }
  }

  return (
    <section>
      <div className="seg">
        <button
          type="button"
          className={'seg__btn' + (tab === 'offshore' ? ' seg__btn--on' : '')}
          onClick={() => setTab('offshore')}
        >
          📋 Offshore
        </button>
        <button
          type="button"
          className={'seg__btn' + (tab === 'base' ? ' seg__btn--on' : '')}
          onClick={() => setTab('base')}
        >
          🏠 Base staff
        </button>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {!loading && !error && tab === 'offshore' && (
        <>
          {total > 0 && (
            <div className="board-controls roster-filters">
              <label className="field">
                <span>Installation</span>
                <select value={fInstall} onChange={(e) => setFInstall(e.target.value)}>
                  <option value="">All installations</option>
                  {installOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.type})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Designation</span>
                <select value={fDesig} onChange={(e) => setFDesig(e.target.value)}>
                  <option value="">All designations</option>
                  {offshoreDesigOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <p className="list-count muted">
            {filtered ? `${shown} of ${total} offshore` : `${total} offshore`} across{' '}
            {groups.length} installation{groups.length === 1 ? '' : 's'}
            {filtered && (
              <button
                type="button"
                className="linkish roster-clear"
                onClick={() => {
                  setFInstall('')
                  setFDesig('')
                }}
              >
                Clear filters
              </button>
            )}
          </p>

          {total === 0 ? (
            <p className="muted empty-state">Nobody is offshore right now.</p>
          ) : shown === 0 ? (
            <p className="muted empty-state">No offshore staff match these filters.</p>
          ) : (
            groups.map((g) => {
              const over = g.people.filter((p) => p.state.key === 'over').length
              const warn = g.people.filter((p) => p.state.key === 'warning').length
              return (
                <div className="roster-group" key={g.installation?.id ?? 'unknown'}>
                  <div className="roster-group__head">
                    <h3 className="roster-group__title">
                      {g.installation?.name ?? 'Unknown'}{' '}
                      <span className="muted">({g.installation?.type})</span>
                    </h3>
                    <span className="roster-group__count">
                      {g.people.length}
                      {over > 0 && <span className="dot dot--red"> ● {over} over</span>}
                      {warn > 0 && <span className="dot dot--amber"> ● {warn} warning</span>}
                    </span>
                  </div>

                  <ul className="card-list">
                    {g.people.map((p) => {
                      const canReplace = p.days >= thresholds.min
                      return (
                        <li key={p.id}>
                          <div className={`roster-card roster-card--col ${p.state.cls}`}>
                            <div className="roster-card__row">
                              <div className="emp-card__main">
                                <span className="emp-card__name">
                                  {p.employee?.full_name ?? '—'}
                                </span>
                                <span className="emp-card__meta">
                                  {p.employee?.emp_id} · {p.employee?.designation?.name ?? '—'}
                                </span>
                              </div>
                              <div className="roster-card__side">
                                <span className={`pill ${p.state.cls}`}>{p.state.label}</span>
                                <span className="roster-card__days">
                                  <strong>{p.days}</strong>d
                                </span>
                              </div>
                            </div>
                            {canReplace && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm roster-card__action"
                                onClick={() => openReplace(p.id)}
                              >
                                🔁 Find replacement
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })
          )}
        </>
      )}

      {!loading && !error && tab === 'base' && (
        <>
          {baseStaff.length > 0 && (
            <label className="field roster-filters">
              <span>Designation</span>
              <select value={fBaseDesig} onChange={(e) => setFBaseDesig(e.target.value)}>
                <option value="">All designations</option>
                {baseDesigOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="list-count muted">
            {fBaseDesig ? `${baseShown.length} of ${baseStaff.length}` : baseStaff.length} on base
          </p>

          {baseStaff.length === 0 ? (
            <p className="muted empty-state">Everyone active is currently offshore.</p>
          ) : baseShown.length === 0 ? (
            <p className="muted empty-state">No base staff for this designation.</p>
          ) : (
            <ul className="card-list">
              {baseShown.map((c) => {
                const status = candidateStatus(c)
                const exp = c.availability?.expires_at?.slice(0, 10)
                const calls = c.availability?.call_count ?? 0
                return (
                  <li key={c.id}>
                    <div className={'roster-card' + (status.key === 'eligible' ? ' state--teal' : '')}>
                      <div className="emp-card__main">
                        <span className="emp-card__name">{c.full_name}</span>
                        <span className="emp-card__meta">
                          {c.emp_id} · {c.designation?.name ?? '—'}
                        </span>
                        <span className="reserve-sub">
                          {c.restDays === null ? 'New — no prior offshore' : `${c.restDays}d rest`}
                          {` · 📞 ${calls} call${calls === 1 ? '' : 's'}`}
                          {c.availability?.last_call_outcome
                            ? ` · ${OUTCOME_LABEL[c.availability.last_call_outcome] ?? c.availability.last_call_outcome}`
                            : ''}
                        </span>
                        {status.blocked && status.reason && (
                          <span className="reserve-sub reserve-sub--block">{status.reason}</span>
                        )}
                      </div>
                      <div className="emp-card__side">
                        <span
                          className={
                            'pill ' +
                            (status.key === 'eligible' ? 'pill--ok' : 'pill--bad')
                          }
                        >
                          {status.label}
                        </span>
                        {c.liveConfirmed ? (
                          <span className="pill pill--ok">
                            Confirmed{exp ? ` · ${exp}` : ''}
                          </span>
                        ) : (
                          <span className="pill pill--muted">Unconfirmed</span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <ReplaceSheet
        open={Boolean(target)}
        target={target}
        targetState={targetState}
        groups={replaceGroups}
        flash={flash}
        error={sheetError}
        onCall={(c) => setCallFor(c)}
        onConfirm={doConfirm}
        onClose={closeReplace}
      />

      <CallDialog
        open={Boolean(callFor)}
        candidate={callFor}
        onClose={() => setCallFor(null)}
        onLog={handleLogCall}
      />
    </section>
  )
}
