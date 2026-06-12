import { useEffect, useMemo, useState } from 'react'
import { listOffshoreStints, batchOnboard, batchOffboard } from '../lib/boarding'
import { loadCandidates } from '../lib/reserve'
import { listInstallations } from '../lib/reference'
import {
  listDocumentTypes,
  listAllEmployeeDocuments,
  computeCertStatus,
} from '../lib/documents'
import { useAuth } from '../context/AuthContext'
import { todayISO, addDays, daysInclusive } from '../lib/dates'
import SelectableEmployeeList from '../components/SelectableEmployeeList'
import Modal from '../components/Modal'

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

// First failing required document, formatted "Name reason" (e.g. "Medical
// Fitness Certificate expired") for the inline cert-block message.
function blockingDoc(cert) {
  const p = cert.problems?.[0]
  return p ? `${p.name} ${p.reason}` : 'cert not current'
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
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function load() {
    setLoading(true)
    const [candRes, instRes] = await Promise.all([
      loadCandidates(),
      listInstallations({ activeOnly: true }),
    ])
    if (candRes.error) setError(candRes.error.message)
    else setBase((candRes.candidates ?? []).filter((c) => c.employment_status === 'active'))
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (candRes.thresholds) setMaxServiceDays(candRes.thresholds.max)
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

  // Cert gate (hard) + confirmation warning (soft) per candidate.
  const isCertBlocked = (c) => !c.cert.certCurrent

  const selectedNotConfirmed = useMemo(
    () => base.filter((c) => selected.has(c.id) && !c.liveConfirmed),
    [base, selected]
  )

  function attemptSubmit() {
    if (!canSubmit) return
    if (selectedNotConfirmed.length > 0) {
      setConfirmOpen(true)
      return
    }
    submit()
  }

  async function submit() {
    setConfirmOpen(false)
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
      <p className="field-hint muted">
        Staff without current certificates are greyed out and cannot be boarded.
      </p>
      <SelectableEmployeeList
        items={base}
        selected={selected}
        onToggle={toggle}
        onSelectAll={selectAll}
        onClear={clear}
        isDisabled={isCertBlocked}
        searchText={(e) => `${e.full_name} ${e.emp_id} ${e.designation?.name ?? ''}`}
        renderPrimary={(e) => e.full_name}
        renderMeta={(e) => `${e.emp_id} · ${e.designation?.name ?? 'No designation'}`}
        renderExtra={(e) =>
          isCertBlocked(e) ? (
            <span className="cert-block">⛔ {blockingDoc(e.cert)}</span>
          ) : !e.liveConfirmed ? (
            <span className="pill pill--warn">Not confirmed</span>
          ) : null
        }
        emptyText="No base staff available to onboard."
      />

      <div className="board-actionbar">
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={attemptSubmit}>
          {busy
            ? 'Onboarding…'
            : `Onboard ${selected.size || ''}${installation ? ` → ${installation.name}` : ''}`.trim()}
        </button>
      </div>

      <Modal
        open={confirmOpen}
        title="Board unconfirmed staff?"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={submit}>
              Board anyway
            </button>
          </>
        }
      >
        <p>
          {selectedNotConfirmed.length} of the selected employees{' '}
          {selectedNotConfirmed.length === 1 ? 'has' : 'have'} not confirmed availability:
        </p>
        <p>
          <strong>{selectedNotConfirmed.map((c) => c.full_name).join(', ')}</strong>
        </p>
        <p className="muted">Board them anyway?</p>
      </Modal>
    </div>
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
