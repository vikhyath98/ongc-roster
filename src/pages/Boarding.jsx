import { useEffect, useMemo, useState } from 'react'
import { listBaseEmployees, listOffshoreStints, batchOnboard, batchOffboard } from '../lib/boarding'
import { listInstallations } from '../lib/reference'
import { getAppConfig, configInt } from '../lib/config'
import { useAuth } from '../context/AuthContext'
import { todayISO, addDays, daysInclusive } from '../lib/dates'
import SelectableEmployeeList from '../components/SelectableEmployeeList'

export default function Boarding() {
  const { user } = useAuth()
  const [tab, setTab] = useState('onboard')

  return (
    <section>
      <div className="seg">
        <button
          type="button"
          className={'seg__btn' + (tab === 'onboard' ? ' seg__btn--on' : '')}
          onClick={() => setTab('onboard')}
        >
          🚁 Onboard
        </button>
        <button
          type="button"
          className={'seg__btn' + (tab === 'offboard' ? ' seg__btn--on' : '')}
          onClick={() => setTab('offboard')}
        >
          🏠 Offboard
        </button>
      </div>

      {tab === 'onboard' ? <OnboardTab userId={user?.id} /> : <OffboardTab userId={user?.id} />}
    </section>
  )
}

function OnboardTab({ userId }) {
  const [base, setBase] = useState([])
  const [installations, setInstallations] = useState([])
  const [maxServiceDays, setMaxServiceDays] = useState(70)
  const [installationId, setInstallationId] = useState('')
  const [signOnDate, setSignOnDate] = useState(todayISO())
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    setLoading(true)
    const [baseRes, instRes, cfgRes] = await Promise.all([
      listBaseEmployees(),
      listInstallations({ activeOnly: true }),
      getAppConfig(),
    ])
    if (baseRes.error) setError(baseRes.error.message)
    else setBase(baseRes.data ?? [])
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (!cfgRes.error) setMaxServiceDays(configInt(cfgRes.config, 'max_service_days', 70))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setDone('')
  }
  const selectAll = (ids) => setSelected(new Set(ids))
  const clear = () => setSelected(new Set())

  const installation = installations.find((i) => i.id === installationId)
  const expected = signOnDate ? addDays(signOnDate, maxServiceDays) : ''
  const canSubmit = installationId && signOnDate && selected.size > 0 && !busy

  async function submit() {
    setBusy(true)
    setError('')
    setDone('')
    const { error: err, count } = await batchOnboard(
      [...selected],
      { installationId, signOnDate, maxServiceDays },
      userId
    )
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setDone(`Onboarded ${count} to ${installation?.name} (sign-on ${signOnDate}).`)
    setSelected(new Set())
    load()
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div className="board-tab">
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
          <span>Sign-on date *</span>
          <input type="date" value={signOnDate} onChange={(e) => setSignOnDate(e.target.value)} />
        </label>
      </div>
      <p className="field-hint muted">
        Expected rotation: <strong>{expected || '—'}</strong> (sign-on + {maxServiceDays} days).
      </p>

      {error && <p className="banner banner--error">{error}</p>}
      {done && <p className="banner banner--info">{done}</p>}

      <h3 className="section-heading">Select base staff to onboard</h3>
      <SelectableEmployeeList
        items={base}
        selected={selected}
        onToggle={toggle}
        onSelectAll={selectAll}
        onClear={clear}
        searchText={(e) => `${e.full_name} ${e.emp_id} ${e.designation?.name ?? ''}`}
        renderPrimary={(e) => e.full_name}
        renderMeta={(e) => `${e.emp_id} · ${e.designation?.name ?? 'No designation'}`}
        emptyText="No base staff available to onboard."
      />

      <div className="board-actionbar">
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
          {busy
            ? 'Onboarding…'
            : `Onboard ${selected.size || ''}${installation ? ` → ${installation.name}` : ''}`.trim()}
        </button>
      </div>
    </div>
  )
}

function OffboardTab({ userId }) {
  const [stints, setStints] = useState([])
  const [filterInstallation, setFilterInstallation] = useState('')
  const [signOffDate, setSignOffDate] = useState(todayISO())
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    setLoading(true)
    const { data, error: err } = await listOffshoreStints()
    if (err) setError(err.message)
    else setStints(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Installations present offshore, for the filter dropdown.
  const sites = useMemo(() => {
    const m = new Map()
    for (const s of stints) if (s.installation) m.set(s.installation.id, s.installation)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [stints])

  const visible = useMemo(
    () => (filterInstallation ? stints.filter((s) => s.installation_id === filterInstallation) : stints),
    [stints, filterInstallation]
  )

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setDone('')
  }
  const selectAll = (ids) => setSelected(new Set(ids))
  const clear = () => setSelected(new Set())

  const canSubmit = signOffDate && selected.size > 0 && !busy

  async function submit() {
    setBusy(true)
    setError('')
    setDone('')
    const chosen = stints.filter((s) => selected.has(s.id))
    const { error: err, count } = await batchOffboard(chosen, signOffDate, userId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setDone(`Offboarded ${count} (sign-off ${signOffDate}).`)
    setSelected(new Set())
    load()
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div className="board-tab">
      <div className="board-controls">
        <label className="field">
          <span>Filter by installation</span>
          <select value={filterInstallation} onChange={(e) => setFilterInstallation(e.target.value)}>
            <option value="">All installations</option>
            {sites.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.type})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sign-off date *</span>
          <input type="date" value={signOffDate} onChange={(e) => setSignOffDate(e.target.value)} />
        </label>
      </div>

      {error && <p className="banner banner--error">{error}</p>}
      {done && <p className="banner banner--info">{done}</p>}

      <h3 className="section-heading">Select offshore staff to offboard</h3>
      <SelectableEmployeeList
        items={visible}
        selected={selected}
        onToggle={toggle}
        onSelectAll={selectAll}
        onClear={clear}
        searchText={(s) =>
          `${s.employee?.full_name ?? ''} ${s.employee?.emp_id ?? ''} ${s.employee?.designation?.name ?? ''}`
        }
        renderPrimary={(s) => s.employee?.full_name ?? '—'}
        renderMeta={(s) =>
          `${s.employee?.emp_id ?? ''} · ${s.employee?.designation?.name ?? ''} · 📍 ${
            s.installation?.name ?? ''
          } · ${daysInclusive(s.sign_on_date)}d served`
        }
        emptyText="Nobody is offshore here."
      />

      <div className="board-actionbar">
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Offboarding…' : `Offboard ${selected.size || ''}`.trim()}
        </button>
      </div>
    </div>
  )
}
