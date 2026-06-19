import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listEmployees, setEmploymentStatus } from '../lib/employees'
import { listOffshoreStints } from '../lib/boarding'
import { listPenaltyExposure, listReconciledPenalties } from '../lib/penalties'
import { getAppConfig, configInt } from '../lib/config'
import { loadCandidates } from '../lib/reserve'
import { loadManifestAlerts } from '../lib/alerts'
import { listInstallationRequirements } from '../lib/configAdmin'
import { listInstallations, listDesignations } from '../lib/reference'
import { daysInclusive, todayISO } from '../lib/dates'
import { rotationState } from '../lib/rotation'
import Modal from '../components/Modal'

const BAND_LABEL = {
  in_service: 'In service',
  eligible: 'Plan Rotation',
  warning: 'Warning',
  over: 'Over threshold',
}

// Pluralise a designation name for the variance lines ("1 Cook" / "2 Cooks").
const plural = (name, n) => `${name}${n > 1 ? 's' : ''}`

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export default function Dashboard() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [stints, setStints] = useState([])
  const [candidates, setCandidates] = useState([])
  const [exposure, setExposure] = useState([])
  const [reconciled, setReconciled] = useState([])
  const [requirements, setRequirements] = useState([])
  const [installations, setInstallations] = useState([])
  const [designations, setDesignations] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [alerts, setAlerts] = useState(null)
  const [alertBusy, setAlertBusy] = useState(false)
  const [alertFlash, setAlertFlash] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bandModal, setBandModal] = useState(null) // band key or null

  async function load() {
    setLoading(true)
    // Reuse the same queries the other modules use; run them in parallel.
    const [empRes, stintRes, expRes, recRes, cfgRes, candRes, reqRes, instRes, desRes] =
      await Promise.all([
        listEmployees(),
        listOffshoreStints(),
        listPenaltyExposure(),
        listReconciledPenalties(),
        getAppConfig(),
        loadCandidates(),
        listInstallationRequirements(),
        listInstallations({ activeOnly: true }),
        listDesignations(),
      ])
    const err =
      empRes.error || stintRes.error || expRes.error || recRes.error || cfgRes.error || candRes.error
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const emps = empRes.data ?? []
    const sts = stintRes.data ?? []
    const th = {
      min: configInt(cfgRes.config, 'min_service_days', 56),
      warning: configInt(cfgRes.config, 'warning_day', 65),
      max: configInt(cfgRes.config, 'max_service_days', 70),
    }
    setEmployees(emps)
    setStints(sts)
    setCandidates(candRes.candidates ?? [])
    setExposure(expRes.data ?? [])
    setReconciled(recRes.data ?? [])
    if (!reqRes.error) setRequirements(reqRes.data ?? [])
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (!desRes.error) setDesignations(desRes.data ?? [])
    setThresholds(th)

    // Manifestation alerts (§14.7) off the same data + a few manifest queries.
    const decoratedLocal = sts.map((s) => {
      const days = daysInclusive(s.sign_on_date)
      return { ...s, days, state: rotationState(days, th) }
    })
    const al = await loadManifestAlerts({
      employees: emps,
      stints: decoratedLocal,
      thresholds: th,
      today: todayISO(),
    })
    if (!al.error) setAlerts(al)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function markAsLeft(emp) {
    if (
      !window.confirm(
        `Mark ${emp.full_name} as left? They'll be set inactive and drop out of the pool. You can reactivate them later in Employee Master.`
      )
    )
      return
    setAlertBusy(true)
    setAlertFlash('')
    const { error: e } = await setEmploymentStatus(emp.id, 'inactive')
    setAlertBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    setAlertFlash(`${emp.full_name} marked as left.`)
    load()
  }

  // Headcount (§6.1 fast lookup via current_installation_id).
  const counts = useMemo(() => {
    let offshore = 0
    let onBase = 0
    let inactive = 0
    for (const e of employees) {
      if (e.employment_status === 'inactive') inactive++
      else if (e.current_installation_id) offshore++
      else onBase++
    }
    return { offshore, onBase, inactive }
  }, [employees])

  // Decorate offshore stints with days + state once; derive bands + attention.
  const decorated = useMemo(
    () =>
      stints
        .map((s) => {
          const days = daysInclusive(s.sign_on_date)
          return { ...s, days, state: rotationState(days, thresholds) }
        })
        .sort((a, b) => b.days - a.days),
    [stints, thresholds]
  )

  const bands = useMemo(() => {
    let inService = 0
    let eligible = 0
    let warning = 0
    let over = 0
    for (const s of decorated) {
      if (s.state.key === 'in_service') inService++
      else if (s.state.key === 'eligible') eligible++
      else if (s.state.key === 'warning') warning++
      else if (s.state.key === 'over') over++
    }
    return { inService, eligible, warning, over, inWindow: eligible + warning + over }
  }, [decorated])

  // Breakdown of one band's offshore stints by designation, count desc, with
  // the distinct installations each designation sits at (no new query).
  const breakdownFor = (key) => {
    const byDesig = new Map()
    for (const s of decorated) {
      if (s.state.key !== key) continue
      const desig = s.employee?.designation?.name ?? '—'
      if (!byDesig.has(desig)) byDesig.set(desig, { designation: desig, count: 0, sites: new Set() })
      const row = byDesig.get(desig)
      row.count++
      if (s.installation?.name) row.sites.add(s.installation.name)
    }
    return [...byDesig.values()]
      .map((r) => ({ designation: r.designation, count: r.count, installations: [...r.sites].sort() }))
      .sort((a, b) => b.count - a.count || a.designation.localeCompare(b.designation))
  }

  const needsAttention = useMemo(
    () => decorated.filter((s) => s.days >= thresholds.warning),
    [decorated, thresholds]
  )

  // Reserve readiness from the same candidates loadCandidates() builds.
  // Confirmed ready = the strict reserve pool (§3.4); eligible-unconfirmed =
  // deployable but not yet confirmed (or confirmation expired).
  const reserve = useMemo(() => {
    const active = candidates.filter((c) => c.employment_status === 'active')
    const deployable = active.filter((c) => c.eligible && c.cert.certCurrent)
    const ready = deployable.filter((c) => c.liveConfirmed).length
    const eligibleUnconfirmed = deployable.length - ready
    return { ready, eligibleUnconfirmed }
  }, [candidates])

  // Pipeline health: confirmed-ready vs everyone in the rotation window.
  const health = useMemo(() => {
    const windowCount = bands.inWindow
    if (windowCount === 0 || reserve.ready >= windowCount) {
      return { cls: 'ok', text: 'Replacement pipeline looks healthy' }
    }
    if (reserve.ready >= windowCount * 0.5) {
      return {
        cls: 'warn',
        text: 'Fewer confirmed replacements than employees in rotation window — call to confirm',
      }
    }
    return { cls: 'bad', text: 'Replacement pipeline is thin — prioritise confirming base staff' }
  }, [reserve.ready, bands.inWindow])

  // Staffing variance: required vs currently-offshore per designation, per
  // active installation that has requirements configured (client-side join).
  const variance = useMemo(() => {
    const desigName = new Map(designations.map((d) => [d.id, d.name]))
    const installById = new Map(installations.map((i) => [i.id, i]))

    // Requirements only for active installations.
    const reqByInstall = new Map()
    for (const r of requirements) {
      if (!installById.has(r.installation_id)) continue
      if (!reqByInstall.has(r.installation_id)) reqByInstall.set(r.installation_id, [])
      reqByInstall.get(r.installation_id).push(r)
    }

    // Current offshore headcount keyed by installation+designation.
    const offCount = new Map()
    for (const s of stints) {
      const inst = s.installation_id ?? s.installation?.id
      const des = s.employee?.designation?.id
      if (!inst || !des) continue
      const key = inst + '|' + des
      offCount.set(key, (offCount.get(key) ?? 0) + 1)
    }

    const rows = []
    for (const [instId, reqs] of reqByInstall) {
      const shortages = []
      const surpluses = []
      for (const r of reqs) {
        const cur = offCount.get(instId + '|' + r.designation_id) ?? 0
        const v = (r.required_count ?? 0) - cur
        const name = desigName.get(r.designation_id) ?? '—'
        if (v > 0) shortages.push({ name, n: v })
        else if (v < 0) surpluses.push({ name, n: -v })
      }
      if (shortages.length === 0 && surpluses.length === 0) continue
      shortages.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
      surpluses.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
      rows.push({ installation: installById.get(instId)?.name ?? '—', shortages, surpluses })
    }
    rows.sort((a, b) => a.installation.localeCompare(b.installation))
    return { rows, anyConfigured: reqByInstall.size > 0 }
  }, [requirements, installations, designations, stints])

  // Open exposure = unreconciled penalty rows (same rule as the Penalty tracker).
  const openExposure = useMemo(() => {
    const reconciledStintIds = new Set(reconciled.map((r) => r.rotation_log_id))
    return exposure
      .filter((e) => !reconciledStintIds.has(e.rotation_log_id))
      .reduce((sum, e) => sum + Number(e.total_penalty || 0), 0)
  }, [exposure, reconciled])

  if (loading) return <p className="muted">Loading dashboard…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  const awaitingCount = alerts ? alerts.awaitingDropped.length + alerts.awaitingNoShow.length : 0
  const totalAlerts = alerts
    ? awaitingCount + alerts.reliefFailed.length + alerts.manifestNeeded.length
    : 0

  // One "Awaiting re-manifest" base-side row (relief that was dropped/no-showed).
  const renderAwaiting = (r) => (
    <div className="roster-card roster-card--col">
      <div className="roster-card__row">
        <div className="emp-card__main">
          <span className="emp-card__name">{r.employee.full_name}</span>
          <span className="emp-card__meta">
            {r.employee.emp_id} · {r.employee.designation?.name ?? '—'}
          </span>
        </div>
        <div className="roster-card__side">
          <span
            className={`pill ${r.severity === 'neutral' ? 'pill--muted' : `pill--${r.severity}`}`}
          >
            {r.daysWaiting}d waiting
          </span>
        </div>
      </div>
      <div className="roster-card__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/boarding')}>
          New request
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={alertBusy}
          onClick={() => markAsLeft(r.employee)}
        >
          Mark as left
        </button>
      </div>
    </div>
  )

  // One offshore alert row (relief-failed / manifest-needed), with an optional action.
  const renderStintRow = (s, blockReason, action) => (
    <div className={`roster-card roster-card--col ${s.state.cls}`}>
      <div className="roster-card__row">
        <div className="emp-card__main">
          <span className="emp-card__name">{s.employee?.full_name ?? '—'}</span>
          <span className="emp-card__meta">
            {s.employee?.designation?.name ?? '—'} · 📍 {s.installation?.name ?? '—'}
          </span>
          <span className={'reserve-sub' + (blockReason.block ? ' reserve-sub--block' : '')}>
            {blockReason.text}
          </span>
        </div>
        <div className="roster-card__side">
          <span className={`pill ${s.state.cls}`}>{s.state.label}</span>
          <span className="roster-card__days">
            <strong>{s.days}</strong>d
          </span>
        </div>
      </div>
      {action}
    </div>
  )

  return (
    <section className="dash">
      {/* Headcount */}
      <div className="dash-stats">
        <Link to="/roster" className="stat-card">
          <span className="stat-card__num">{counts.offshore}</span>
          <span className="stat-card__label">Offshore</span>
        </Link>
        <Link to="/employees" className="stat-card">
          <span className="stat-card__num">{counts.onBase}</span>
          <span className="stat-card__label">On base</span>
        </Link>
        <Link to="/employees" className="stat-card stat-card--muted">
          <span className="stat-card__num">{counts.inactive}</span>
          <span className="stat-card__label">Inactive</span>
        </Link>
      </div>

      {/* Manifestation alerts (§14.7) */}
      {alertFlash && <p className="banner banner--info">{alertFlash}</p>}

      {totalAlerts > 0 && (
        <>
          {awaitingCount > 0 && (
            <div className="dash-card">
              <div className="dash-card__head">
                <h3>⏳ Awaiting re-manifest</h3>
                <span className="muted">{awaitingCount} on base</span>
              </div>
              {alerts.awaitingDropped.length > 0 && (
                <>
                  <p className="alert-subhead muted">Dropped — chase ONGC for a seat</p>
                  <ul className="card-list">
                    {alerts.awaitingDropped.map((r) => (
                      <li key={r.employee.id}>{renderAwaiting(r)}</li>
                    ))}
                  </ul>
                </>
              )}
              {alerts.awaitingNoShow.length > 0 && (
                <>
                  <p className="alert-subhead muted">
                    No-show — chase the employee / reconsider reliability
                  </p>
                  <ul className="card-list">
                    {alerts.awaitingNoShow.map((r) => (
                      <li key={r.employee.id}>{renderAwaiting(r)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {alerts.reliefFailed.length > 0 && (
            <div className="dash-card">
              <div className="dash-card__head">
                <h3>🚁 Relief failed to arrive</h3>
                <span className="muted">{alerts.reliefFailed.length} overdue</span>
              </div>
              <ul className="card-list">
                {alerts.reliefFailed.map(({ stint: s, reason }) => (
                  <li key={s.id}>
                    {renderStintRow(
                      s,
                      {
                        block: true,
                        text:
                          reason === 'dropped'
                            ? 'Last relief was dropped by ONGC — no seat'
                            : 'Last relief no-showed — did not board',
                      },
                      null
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alerts.manifestNeeded.length > 0 && (
            <div className="dash-card">
              <div className="dash-card__head">
                <h3>📋 Manifest needed soon</h3>
                <span className="muted">{alerts.manifestNeeded.length} unrequested</span>
              </div>
              <ul className="card-list">
                {alerts.manifestNeeded.map(({ stint: s }) => (
                  <li key={s.id}>
                    {renderStintRow(
                      s,
                      { block: false, text: 'No manifest request filed yet' },
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm roster-card__action"
                        onClick={() => navigate('/boarding')}
                      >
                        ＋ Create manifest request
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Rotation window */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Rotation window</h3>
          <span className="muted">{bands.inWindow} at day {thresholds.min}+</span>
        </div>
        <div className="band-row band-row--4">
          <div className="band band--green">
            <span className="band__num">{bands.inService}</span>
            <span className="band__label">In service<br />&lt; {thresholds.min}d</span>
          </div>
          <button
            type="button"
            className="band band--teal band--click"
            onClick={() => setBandModal('eligible')}
          >
            <span className="band__num">{bands.eligible}</span>
            <span className="band__label">Plan Rotation<br />{thresholds.min}–{thresholds.warning - 1}d</span>
          </button>
          <button
            type="button"
            className="band band--amber band--click"
            onClick={() => setBandModal('warning')}
          >
            <span className="band__num">{bands.warning}</span>
            <span className="band__label">Warning<br />{thresholds.warning}–{thresholds.max - 1}d</span>
          </button>
          <button
            type="button"
            className="band band--red band--click"
            onClick={() => setBandModal('over')}
          >
            <span className="band__num">{bands.over}</span>
            <span className="band__label">Over<br />{thresholds.max}d+</span>
          </button>
        </div>
      </div>

      {/* Reserve readiness */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Reserve readiness</h3>
        </div>
        <div className="readiness-row">
          <Link to="/roster?tab=base&confirm=confirmed" className="readiness-cell">
            <span className="readiness-num">{reserve.ready}</span>
            <span className="readiness-label">Confirmed ready</span>
          </Link>
          <Link to="/roster?tab=base&confirm=unconfirmed" className="readiness-cell">
            <span className="readiness-num">{reserve.eligibleUnconfirmed}</span>
            <span className="readiness-label">Eligible (unconfirmed)</span>
          </Link>
        </div>
        <p className={`readiness-health readiness-health--${health.cls}`}>{health.text}</p>
      </div>

      {/* Penalty exposure */}
      <Link to="/penalties" className="dash-card dash-card--link penalty-exposure">
        <span className="dash-card__sublabel">Open penalty exposure</span>
        <span className="penalty-exposure__value">{inr.format(openExposure)}</span>
        <span className="muted">unreconciled · tap to review</span>
      </Link>

      {/* Staffing variance */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Staffing variance</h3>
        </div>
        {!variance.anyConfigured ? (
          <p className="muted">Set up staffing requirements in Configuration to see variance.</p>
        ) : variance.rows.length === 0 ? (
          <p className="readiness-health readiness-health--ok">All installations fully staffed</p>
        ) : (
          <div className="variance-list">
            {variance.rows.map((r) => (
              <div className="variance-install" key={r.installation}>
                <h4 className="variance-install__name">{r.installation}</h4>
                {r.shortages.map((s, i) => (
                  <p key={`s${i}`} className="variance-row variance-row--short">
                    ● Short {s.n} {plural(s.name, s.n)}
                  </p>
                ))}
                {r.surpluses.map((s, i) => (
                  <p key={`u${i}`} className="variance-row variance-row--surplus">
                    ● Surplus {s.n} {plural(s.name, s.n)}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Needs attention */}
      <div className="dash-card__head dash-attention-head">
        <h3>Needs attention</h3>
        <span className="muted">≥ {thresholds.warning} days</span>
      </div>
      {needsAttention.length === 0 ? (
        <p className="muted empty-state">Nobody is at or past the warning day. 👍</p>
      ) : (
        <ul className="card-list">
          {needsAttention.map((s) => (
            <li key={s.id}>
              <div className={`roster-card ${s.state.cls}`}>
                <div className="emp-card__main">
                  <span className="emp-card__name">{s.employee?.full_name ?? '—'}</span>
                  <span className="emp-card__meta">
                    {s.employee?.designation?.name ?? '—'} · 📍 {s.installation?.name ?? '—'}
                  </span>
                </div>
                <div className="roster-card__side">
                  <span className={`pill ${s.state.cls}`}>{s.state.label}</span>
                  <span className="roster-card__days">
                    <strong>{s.days}</strong>d
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(bandModal)}
        title={
          bandModal
            ? `${BAND_LABEL[bandModal]} — ${bands[bandModal]} employee${bands[bandModal] === 1 ? '' : 's'}`
            : ''
        }
        onClose={() => setBandModal(null)}
        footer={
          <button type="button" className="btn btn--primary" onClick={() => setBandModal(null)}>
            Close
          </button>
        }
      >
        {bandModal &&
          (breakdownFor(bandModal).length === 0 ? (
            <p className="muted empty-state">Nobody in this band.</p>
          ) : (
            <ul className="breakdown-list">
              {breakdownFor(bandModal).map((r) => (
                <li key={r.designation} className="breakdown-row">
                  <div className="breakdown-row__main">
                    <span className="breakdown-row__desig">{r.designation}</span>
                    <span className="breakdown-row__sites muted">{r.installations.join(' · ')}</span>
                  </div>
                  <span className="breakdown-row__count">{r.count}</span>
                </li>
              ))}
            </ul>
          ))}
      </Modal>
    </section>
  )
}
