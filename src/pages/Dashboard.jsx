import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listEmployees } from '../lib/employees'
import { listOffshoreStints } from '../lib/boarding'
import { listPenaltyExposure, listReconciledPenalties } from '../lib/penalties'
import { getAppConfig, configInt } from '../lib/config'
import { daysInclusive } from '../lib/dates'
import { rotationState } from '../lib/rotation'

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export default function Dashboard() {
  const [employees, setEmployees] = useState([])
  const [stints, setStints] = useState([])
  const [exposure, setExposure] = useState([])
  const [reconciled, setReconciled] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      // Reuse the same queries the other modules use; run them in parallel.
      const [empRes, stintRes, expRes, recRes, cfgRes] = await Promise.all([
        listEmployees(),
        listOffshoreStints(),
        listPenaltyExposure(),
        listReconciledPenalties(),
        getAppConfig(),
      ])
      const err =
        empRes.error || stintRes.error || expRes.error || recRes.error || cfgRes.error
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setEmployees(empRes.data ?? [])
      setStints(stintRes.data ?? [])
      setExposure(expRes.data ?? [])
      setReconciled(recRes.data ?? [])
      setThresholds({
        min: configInt(cfgRes.config, 'min_service_days', 56),
        warning: configInt(cfgRes.config, 'warning_day', 65),
        max: configInt(cfgRes.config, 'max_service_days', 70),
      })
      setLoading(false)
    })()
  }, [])

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
    let eligible = 0
    let warning = 0
    let over = 0
    for (const s of decorated) {
      if (s.state.key === 'eligible') eligible++
      else if (s.state.key === 'warning') warning++
      else if (s.state.key === 'over') over++
    }
    return { eligible, warning, over, inWindow: eligible + warning + over }
  }, [decorated])

  const needsAttention = useMemo(
    () => decorated.filter((s) => s.days >= thresholds.warning),
    [decorated, thresholds]
  )

  // Open exposure = unreconciled penalty rows (same rule as the Penalty tracker).
  const openExposure = useMemo(() => {
    const reconciledStintIds = new Set(reconciled.map((r) => r.rotation_log_id))
    return exposure
      .filter((e) => !reconciledStintIds.has(e.rotation_log_id))
      .reduce((sum, e) => sum + Number(e.total_penalty || 0), 0)
  }, [exposure, reconciled])

  if (loading) return <p className="muted">Loading dashboard…</p>
  if (error) return <p className="banner banner--error">{error}</p>

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

      {/* Rotation window */}
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Rotation window</h3>
          <span className="muted">{bands.inWindow} at day {thresholds.min}+</span>
        </div>
        <div className="band-row">
          <div className="band band--teal">
            <span className="band__num">{bands.eligible}</span>
            <span className="band__label">Eligible<br />{thresholds.min}–{thresholds.warning - 1}d</span>
          </div>
          <div className="band band--amber">
            <span className="band__num">{bands.warning}</span>
            <span className="band__label">Warning<br />{thresholds.warning}–{thresholds.max - 1}d</span>
          </div>
          <div className="band band--red">
            <span className="band__num">{bands.over}</span>
            <span className="band__label">Over<br />{thresholds.max}d+</span>
          </div>
        </div>
      </div>

      {/* Penalty exposure */}
      <Link to="/penalties" className="dash-card dash-card--link penalty-exposure">
        <span className="dash-card__sublabel">Open penalty exposure</span>
        <span className="penalty-exposure__value">{inr.format(openExposure)}</span>
        <span className="muted">unreconciled · tap to review</span>
      </Link>

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
    </section>
  )
}
