import { useEffect, useMemo, useState } from 'react'
import { listOffshoreStints, batchOffboard } from '../lib/boarding'
import {
  listDocumentTypes,
  listAllEmployeeDocuments,
  computeCertStatus,
} from '../lib/documents'
import { useAuth } from '../context/AuthContext'
import { todayISO, daysInclusive } from '../lib/dates'
import SelectableEmployeeList from '../components/SelectableEmployeeList'
import ManifestTab from '../components/manifest/ManifestTab'

// The Board screen. Onboarding now flows through the formal Manifest → RFM
// pipeline (Manifest tab); Offboard closes stints. The old ad-hoc batch
// Onboard tab is gone — its only escape hatch is the Manual onboard
// (exception) link inside the Manifest tab.
export default function Boarding() {
  const { user } = useAuth()
  const [tab, setTab] = useState('manifest')

  return (
    <section>
      <div className="seg">
        <button
          type="button"
          className={'seg__btn' + (tab === 'manifest' ? ' seg__btn--on' : '')}
          onClick={() => setTab('manifest')}
        >
          📋 Manifest
        </button>
        <button
          type="button"
          className={'seg__btn' + (tab === 'offboard' ? ' seg__btn--on' : '')}
          onClick={() => setTab('offboard')}
        >
          🏠 Offboard
        </button>
      </div>

      {tab === 'manifest' ? <ManifestTab userId={user?.id} /> : <OffboardTab userId={user?.id} />}
    </section>
  )
}

function OffboardTab({ userId }) {
  const [stints, setStints] = useState([])
  const [docTypes, setDocTypes] = useState([])
  const [docsByEmp, setDocsByEmp] = useState(new Map())
  const [filterInstallation, setFilterInstallation] = useState('')
  const [signOffDate, setSignOffDate] = useState(todayISO())
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    setLoading(true)
    const [stintRes, dtRes, docsRes] = await Promise.all([
      listOffshoreStints(),
      listDocumentTypes(),
      listAllEmployeeDocuments(),
    ])
    if (stintRes.error) setError(stintRes.error.message)
    else setStints(stintRes.data ?? [])
    if (!dtRes.error) setDocTypes(dtRes.data ?? [])
    if (!docsRes.error) {
      const m = new Map()
      for (const d of docsRes.data ?? []) {
        if (!m.has(d.employee_id)) m.set(d.employee_id, [])
        m.get(d.employee_id).push(d)
      }
      setDocsByEmp(m)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Read-only cert status per offshore employee (awareness only — no gate).
  const certFor = (s) =>
    computeCertStatus(
      s.employee?.designation?.id,
      docTypes,
      docsByEmp.get(s.employee?.id) ?? []
    )

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
        renderExtra={(s) => {
          const cert = certFor(s)
          return cert.certCurrent ? (
            <span className="pill pill--ok">Certs OK</span>
          ) : (
            <span className="pill pill--bad">
              {cert.problems.length} cert issue{cert.problems.length === 1 ? '' : 's'}
            </span>
          )
        }}
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
