import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listOffshoreStints } from '../lib/boarding'
import {
  loadCandidates,
  logCall,
  candidateStatus,
  splitReplacementGroups,
  bulkConfirmAvailability,
} from '../lib/reserve'
import { daysInclusive, addDays } from '../lib/dates'
import { rotationState } from '../lib/rotation'
import { baseLocationTag } from '../lib/location'
import { useAuth } from '../context/AuthContext'
import ReplaceSheet from '../components/ReplaceSheet'
import CallDialog from '../components/CallDialog'
import BulkConfirmAvailability from '../components/BulkConfirmAvailability'

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
  const [searchParams] = useSearchParams()
  // Deep-link support from the Dashboard reserve-readiness tiles.
  const [tab, setTab] = useState(searchParams.get('tab') === 'base' ? 'base' : 'offshore')
  const [stints, setStints] = useState([])
  const [candidates, setCandidates] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [validityDays, setValidityDays] = useState(14)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Offshore-tab filters.
  const [fInstall, setFInstall] = useState('')
  const [fDesig, setFDesig] = useState('')
  // Base-tab filters (designation + confirmation, the latter deep-linkable).
  const [fBaseDesig, setFBaseDesig] = useState('')
  const [fBaseConfirm, setFBaseConfirm] = useState(
    ['confirmed', 'unconfirmed'].includes(searchParams.get('confirm'))
      ? searchParams.get('confirm')
      : 'all'
  )

  // Replacement sheet + call dialog.
  const [replaceForId, setReplaceForId] = useState(null)
  const [callFor, setCallFor] = useState(null)
  const [flash, setFlash] = useState('')
  const [sheetError, setSheetError] = useState('')
  // Base-staff tab quick-confirm toast.
  const [baseFlash, setBaseFlash] = useState('')
  const [baseError, setBaseError] = useState('')
  // Base-staff bulk-confirm select mode (Workstream C). Distinct from the
  // per-card quick Confirm above: a multi-select + sticky action bar.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedBase, setSelectedBase] = useState(new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)

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

  // Flat, urgency-sorted offshore list (most days served first), filtered.
  const offshoreList = useMemo(
    () =>
      stints
        .filter((s) => !fInstall || s.installation_id === fInstall)
        .filter((s) => !fDesig || s.employee?.designation?.id === fDesig)
        .map((s) => {
          const days = daysInclusive(s.sign_on_date)
          return { ...s, days, state: rotationState(days, thresholds) }
        })
        .sort((a, b) => b.days - a.days),
    [stints, thresholds, fInstall, fDesig]
  )

  const total = stints.length
  const shown = offshoreList.length
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
  const baseShown = useMemo(() => {
    let list = fBaseDesig ? baseStaff.filter((c) => c.designation_id === fBaseDesig) : baseStaff
    if (fBaseConfirm === 'confirmed') list = list.filter((c) => c.liveConfirmed)
    else if (fBaseConfirm === 'unconfirmed') list = list.filter((c) => !c.liveConfirmed)
    return list
  }, [baseStaff, fBaseDesig, fBaseConfirm])
  const baseFiltered = Boolean(fBaseDesig) || fBaseConfirm !== 'all'

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

  // Quick confirm one base employee (no call flow) with a transient toast.
  async function quickConfirm(c) {
    setBaseError('')
    setBaseFlash('')
    const { error: err } = await bulkConfirmAvailability([c], { userId: user?.id })
    if (err) {
      setBaseError(err.message)
      return
    }
    await load()
    setBaseFlash(`${c.full_name} confirmed.`)
    setTimeout(() => setBaseFlash(''), 2500)
  }

  // ----- Base-staff bulk confirm (select mode) -----
  const selectedBaseEmployees = useMemo(
    () => baseStaff.filter((c) => selectedBase.has(c.id)),
    [baseStaff, selectedBase]
  )
  const allShownSelected =
    baseShown.length > 0 && baseShown.every((c) => selectedBase.has(c.id))

  function toggleSelectMode() {
    setSelectMode((on) => !on)
    setSelectedBase(new Set())
    setBaseFlash('')
    setBaseError('')
  }
  function toggleBaseSelect(id) {
    setSelectedBase((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAllBase = () => setSelectedBase(new Set(baseShown.map((c) => c.id)))
  const clearBaseSelect = () => setSelectedBase(new Set())

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
            {filtered ? `${shown} of ${total} offshore` : `${total} offshore`}
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
            <ul className="card-list">
              {offshoreList.map((p) => {
                const canReplace = p.days >= thresholds.min
                return (
                  <li key={p.id}>
                    <div className={`roster-card roster-card--col ${p.state.cls}`}>
                      <div className="roster-card__row">
                        <div className="emp-card__main">
                          <span className="emp-card__name">{p.employee?.full_name ?? '—'}</span>
                          <span className="emp-card__meta">
                            {p.employee?.emp_id} · {p.employee?.designation?.name ?? '—'}
                          </span>
                          <span className="reserve-sub">
                            📍 {p.installation?.name ?? '—'} · rotate by{' '}
                            {p.expected_rotation_date || deadlineFor(p)}
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
          )}
        </>
      )}

      {!loading && !error && tab === 'base' && (
        <>
          {baseFlash && <p className="banner banner--info">{baseFlash}</p>}
          {baseError && <p className="banner banner--error">{baseError}</p>}
          {baseStaff.length > 0 && (
            <div className="board-controls roster-filters">
              <label className="field">
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
              <label className="field">
                <span>Confirmation</span>
                <select value={fBaseConfirm} onChange={(e) => setFBaseConfirm(e.target.value)}>
                  <option value="all">All</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="unconfirmed">Unconfirmed</option>
                </select>
              </label>
            </div>
          )}

          <div className="list-toolbar">
            <p className="list-count muted">
              {baseFiltered ? `${baseShown.length} of ${baseStaff.length}` : baseStaff.length} on base
            </p>
            {baseStaff.length > 0 && (
              <button type="button" className="linkish" onClick={toggleSelectMode}>
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
          </div>

          {selectMode && (
            <div className="select-list__bar">
              <span className="muted">
                {selectedBase.size} selected · {baseShown.length} shown
              </span>
              <div className="select-list__bar-actions">
                <button
                  type="button"
                  className="linkish"
                  onClick={selectAllBase}
                  disabled={baseShown.length === 0 || allShownSelected}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="linkish"
                  onClick={clearBaseSelect}
                  disabled={selectedBase.size === 0}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {baseStaff.length === 0 ? (
            <p className="muted empty-state">Everyone active is currently offshore.</p>
          ) : baseShown.length === 0 ? (
            <p className="muted empty-state">No base staff match these filters.</p>
          ) : (
            <ul className="card-list">
              {baseShown.map((c) => {
                const status = candidateStatus(c)
                const exp = c.availability?.expires_at?.slice(0, 10)
                const calls = c.availability?.call_count ?? 0
                const locTag = baseLocationTag(c)
                return (
                  <li key={c.id}>
                    <div
                      className={
                        'roster-card roster-card--col' +
                        (status.key === 'eligible' ? ' state--teal' : '') +
                        (selectMode ? ' roster-card--selectable' : '') +
                        (selectMode && selectedBase.has(c.id) ? ' is-selected' : '')
                      }
                      onClick={selectMode ? () => toggleBaseSelect(c.id) : undefined}
                      role={selectMode ? 'button' : undefined}
                      aria-pressed={selectMode ? selectedBase.has(c.id) : undefined}
                    >
                      <div className="roster-card__row">
                        {selectMode && (
                          <input
                            type="checkbox"
                            className="roster-card__check"
                            checked={selectedBase.has(c.id)}
                            readOnly
                            tabIndex={-1}
                            aria-hidden="true"
                          />
                        )}
                        <div className="emp-card__main">
                          <span className="emp-card__name">{c.full_name}</span>
                          <span className="emp-card__meta">
                            {c.emp_id} · {c.designation?.name ?? '—'}
                          </span>
                          {locTag && <span className="reserve-sub">{locTag}</span>}
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
                              'pill ' + (status.key === 'eligible' ? 'pill--ok' : 'pill--bad')
                            }
                          >
                            {status.label}
                          </span>
                          {c.liveConfirmed ? (
                            <span className="pill pill--ok">Confirmed{exp ? ` · ${exp}` : ''}</span>
                          ) : (
                            <span className="pill pill--muted">Unconfirmed</span>
                          )}
                        </div>
                      </div>
                      {!selectMode && (
                        <div className="roster-card__actions">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setCallFor(c)}
                          >
                            Call…
                          </button>
                          {!c.liveConfirmed && (
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() => quickConfirm(c)}
                            >
                              Confirm
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {selectMode && selectedBase.size > 0 && (
            <>
              <div className="board-actionbar-spacer" aria-hidden="true" />
              <div className="board-actionbar">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setBulkConfirmOpen(true)}
                >
                  Confirm Availability ({selectedBase.size})
                </button>
              </div>
            </>
          )}
        </>
      )}

      <BulkConfirmAvailability
        open={bulkConfirmOpen}
        employees={selectedBaseEmployees}
        onDone={() => {
          setBaseFlash(
            `Confirmed availability for ${selectedBaseEmployees.length} employee${
              selectedBaseEmployees.length === 1 ? '' : 's'
            }.`
          )
          load()
        }}
        onClose={() => {
          setBulkConfirmOpen(false)
          setSelectMode(false)
          setSelectedBase(new Set())
        }}
      />

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
