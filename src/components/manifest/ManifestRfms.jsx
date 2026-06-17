import { useEffect, useMemo, useState } from 'react'
import {
  listRfms,
  getRfm,
  createRfm,
  listManifestRequests,
  listRequestItems,
  recordRfmOutcome,
} from '../../lib/manifest'
import { listInstallations } from '../../lib/reference'
import { listEmployees } from '../../lib/employees'
import {
  listDocumentTypes,
  listAllEmployeeDocuments,
  computeCertStatus,
} from '../../lib/documents'
import { getAppConfig, configInt } from '../../lib/config'
import { todayISO } from '../../lib/dates'
import Modal from '../Modal'

// First failing required document, "Name reason" (e.g. "Medical Fitness
// Certificate expired"), matching the old Onboard cert gate (§6.4).
function blockingDoc(cert) {
  const p = cert.problems?.[0]
  return p ? `${p.name} ${p.reason}` : 'cert not current'
}

const MODES = ['Air', 'Sea', 'Other']
const OUTCOME_PILL = {
  listed: { label: 'Listed', cls: 'pill' },
  boarded: { label: 'Boarded', cls: 'pill pill--ok' },
  dropped: { label: 'Dropped', cls: 'pill pill--warn' },
  no_show: { label: 'No-show', cls: 'pill pill--bad' },
}

export default function ManifestRfms({ userId }) {
  const [rfms, setRfms] = useState([])
  const [installations, setInstallations] = useState([])
  const [requests, setRequests] = useState([])
  const [employees, setEmployees] = useState([])
  const [cfg, setCfg] = useState({ maxServiceDays: 70, reliefGraceDays: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)

  async function load() {
    setLoading(true)
    const [rfmRes, instRes, reqRes, empRes, cfgRes] = await Promise.all([
      listRfms(),
      listInstallations({ activeOnly: true }),
      listManifestRequests(),
      listEmployees(),
      getAppConfig(),
    ])
    if (rfmRes.error) {
      setError(rfmRes.error.message)
      setLoading(false)
      return
    }
    setRfms(rfmRes.data ?? [])
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (!reqRes.error) setRequests(reqRes.data ?? [])
    if (!empRes.error) setEmployees((empRes.data ?? []).filter((e) => e.employment_status === 'active'))
    if (!cfgRes.error) {
      setCfg({
        maxServiceDays: configInt(cfgRes.config, 'max_service_days', 70),
        reliefGraceDays: configInt(cfgRes.config, 'relief_grace_period_days', 1),
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const counts = (rfm) => {
    const li = rfm.line_items ?? []
    const by = (o) => li.filter((x) => x.outcome === o).length
    return { boarded: by('boarded'), dropped: by('dropped'), no_show: by('no_show'), listed: by('listed') }
  }

  if (loading) return <p className="muted">Loading RFMs…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  return (
    <div>
      <div className="toolbar">
        <span className="muted list-count">{rfms.length} RFMs</span>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
          ＋ Log RFM
        </button>
      </div>

      {rfms.length === 0 ? (
        <p className="muted empty-state">No RFMs logged yet.</p>
      ) : (
        <ul className="card-list">
          {rfms.map((r) => {
            const c = counts(r)
            return (
              <li key={r.id}>
                <button type="button" className="emp-card" onClick={() => setDetailId(r.id)}>
                  <div className="emp-card__main">
                    <span className="emp-card__name">RFM {r.rfm_number}</span>
                    <span className="emp-card__meta">
                      {r.sortie_date} · 📍 {r.installation?.name ?? '—'} · {r.mode_of_journey}
                    </span>
                  </div>
                  <div className="emp-card__side">
                    <span className="muted" style={{ fontSize: '0.72rem' }}>
                      {c.boarded}✓ {c.dropped}↓ {c.no_show}✗ {c.listed}•
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <LogRfmModal
        open={formOpen}
        installations={installations}
        requests={requests}
        employees={employees}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false)
          load()
        }}
      />

      <RfmDetailModal
        rfmId={detailId}
        userId={userId}
        cfg={cfg}
        onClose={() => setDetailId(null)}
        onChanged={load}
      />
    </div>
  )
}

function LogRfmModal({ open, installations, requests, employees, onClose, onCreated }) {
  const [rfmNumber, setRfmNumber] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [sortieDate, setSortieDate] = useState(todayISO())
  const [depTime, setDepTime] = useState('')
  const [reportTime, setReportTime] = useState('')
  const [mode, setMode] = useState('Air')
  const [requestId, setRequestId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([]) // [{ employeeId, vendorCode }]
  const [addEmpId, setAddEmpId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRfmNumber('')
    setInstallationId('')
    setSortieDate(todayISO())
    setDepTime('')
    setReportTime('')
    setMode('Air')
    setRequestId('')
    setNotes('')
    setLines([])
    setAddEmpId('')
    setBusy(false)
    setError('')
  }, [open])

  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  // Pre-fill lines (and installation) when a request is linked.
  async function onPickRequest(id) {
    setRequestId(id)
    if (!id) return
    const req = requests.find((r) => r.id === id)
    if (req?.installation?.id) setInstallationId(req.installation.id)
    const { data, error: err } = await listRequestItems(id)
    if (err) {
      setError(err.message)
      return
    }
    setLines((data ?? []).map((it) => ({ employeeId: it.employee_id, vendorCode: '' })))
  }

  function addLine() {
    if (!addEmpId || lines.some((l) => l.employeeId === addEmpId)) return
    setLines((l) => [...l, { employeeId: addEmpId, vendorCode: '' }])
    setAddEmpId('')
  }
  const removeLine = (id) => setLines((l) => l.filter((x) => x.employeeId !== id))
  const setVendor = (id, v) =>
    setLines((l) => l.map((x) => (x.employeeId === id ? { ...x, vendorCode: v } : x)))

  const canCreate = rfmNumber.trim() && installationId && sortieDate && mode && lines.length > 0 && !busy

  async function create() {
    setBusy(true)
    setError('')
    const { error: err } = await createRfm(
      {
        rfmNumber,
        installationId,
        sortieDate,
        scheduledDepTime: depTime,
        scheduledReportTime: reportTime,
        modeOfJourney: mode,
        manifestRequestId: requestId,
        notes,
      },
      lines
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
      title="Log RFM"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canCreate} onClick={create}>
            {busy ? 'Saving…' : `Log RFM${lines.length ? ` (${lines.length})` : ''}`}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Link to manifest request (optional)</span>
        <select value={requestId} onChange={(e) => onPickRequest(e.target.value)}>
          <option value="">— none —</option>
          {requests.map((r) => (
            <option key={r.id} value={r.id}>
              {r.installation?.name} · {r.request_date} ({r.items?.length ?? 0})
            </option>
          ))}
        </select>
      </label>

      <div className="board-controls">
        <label className="field">
          <span>RFM number *</span>
          <input value={rfmNumber} onChange={(e) => setRfmNumber(e.target.value)} />
        </label>
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
      </div>

      <div className="board-controls">
        <label className="field">
          <span>Sortie date *</span>
          <input type="date" value={sortieDate} onChange={(e) => setSortieDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Mode *</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="board-controls">
        <label className="field">
          <span>Scheduled departure</span>
          <input type="time" value={depTime} onChange={(e) => setDepTime(e.target.value)} />
        </label>
        <label className="field">
          <span>Report time</span>
          <input type="time" value={reportTime} onChange={(e) => setReportTime(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <h3 className="section-heading">Line items ({lines.length})</h3>
      {lines.length === 0 && <p className="muted">Link a request, or add employees below.</p>}
      <ul className="card-list">
        {lines.map((l) => (
          <li key={l.employeeId}>
            <div className="roster-card">
              <div className="emp-card__main">
                <span className="emp-card__name">{empName.get(l.employeeId)?.full_name ?? '—'}</span>
                <span className="emp-card__meta">
                  {empName.get(l.employeeId)?.emp_id ?? ''}
                </span>
              </div>
              <div className="rfm-line-controls">
                <input
                  className="req-input"
                  placeholder="Vendor"
                  value={l.vendorCode}
                  onChange={(e) => setVendor(l.employeeId, e.target.value)}
                />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeLine(l.employeeId)}>
                  ✕
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="rfm-add-line">
        <select value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)}>
          <option value="">Add employee…</option>
          {employees
            .filter((e) => !lines.some((l) => l.employeeId === e.id))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {e.designation?.name ?? '—'}
              </option>
            ))}
        </select>
        <button type="button" className="btn btn--ghost btn--sm" disabled={!addEmpId} onClick={addLine}>
          Add
        </button>
      </div>

      {error && <p className="banner banner--error">{error}</p>}
    </Modal>
  )
}

function RfmDetailModal({ rfmId, userId, cfg, onClose, onChanged }) {
  const [rfm, setRfm] = useState(null)
  const [docTypes, setDocTypes] = useState([])
  const [docsByEmp, setDocsByEmp] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState({}) // lineId -> reason text
  const [busyLine, setBusyLine] = useState(null)

  async function load() {
    if (!rfmId) return
    setLoading(true)
    setError('')
    const [rfmRes, dtRes, docsRes] = await Promise.all([
      getRfm(rfmId),
      listDocumentTypes(),
      listAllEmployeeDocuments(),
    ])
    if (rfmRes.error) setError(rfmRes.error.message)
    else setRfm(rfmRes.data)
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

  // Cert-current check for an RFM line's employee (§6.4) — gates Boarded.
  const certFor = (line) =>
    computeCertStatus(line.employee?.designation?.id, docTypes, docsByEmp.get(line.employee_id) ?? [])

  useEffect(() => {
    if (rfmId) {
      setReasons({})
      load()
    } else {
      setRfm(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfmId])

  async function record(line, outcome) {
    // Cert gate (§6.4): never board someone whose required docs aren't current.
    if (outcome === 'boarded') {
      const cert = certFor(line)
      if (!cert.certCurrent) {
        setError(`Cannot board ${line.employee?.full_name} — ${blockingDoc(cert)}.`)
        return
      }
    }
    setBusyLine(line.id)
    setError('')
    const { error: err } = await recordRfmOutcome(line, outcome, {
      reason: reasons[line.id],
      userId,
      rfm: { installation_id: rfm.installation_id, sortie_date: rfm.sortie_date },
      maxServiceDays: cfg.maxServiceDays,
      reliefGraceDays: cfg.reliefGraceDays,
    })
    setBusyLine(null)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged?.()
  }

  return (
    <Modal
      open={Boolean(rfmId)}
      title={rfm ? `RFM ${rfm.rfm_number}` : 'RFM'}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="banner banner--error">{error}</p>}
      {rfm && (
        <>
          <p className="muted">
            {rfm.sortie_date} · 📍 {rfm.installation?.name} · {rfm.mode_of_journey}
            {rfm.scheduled_dep_time ? ` · dep ${rfm.scheduled_dep_time}` : ''}
            {rfm.scheduled_report_time ? ` · report ${rfm.scheduled_report_time}` : ''}
          </p>

          <ul className="card-list">
            {(rfm.line_items ?? []).map((line) => {
              const op = OUTCOME_PILL[line.outcome] ?? OUTCOME_PILL.listed
              const settled = line.outcome !== 'listed'
              const cert = certFor(line)
              const certBlocked = !cert.certCurrent
              return (
                <li key={line.id}>
                  <div className="roster-card roster-card--col">
                    <div className="roster-card__row">
                      <div className="emp-card__main">
                        <span className="emp-card__name">{line.employee?.full_name ?? '—'}</span>
                        <span className="emp-card__meta">
                          {line.employee?.emp_id} · {line.employee?.designation?.name ?? '—'}
                          {line.vendor_code ? ` · ${line.vendor_code}` : ''}
                        </span>
                        {settled && line.outcome_reason && (
                          <span className="reserve-sub">“{line.outcome_reason}”</span>
                        )}
                      </div>
                      <span className={op.cls}>{op.label}</span>
                    </div>

                    {!settled && (
                      <>
                        {certBlocked && (
                          <span className="cert-block" style={{ marginTop: 8 }}>
                            ⛔ {blockingDoc(cert)} — cannot board
                          </span>
                        )}
                        <input
                          className="search"
                          style={{ marginTop: 8 }}
                          placeholder="Reason (optional — for dropped / no-show)"
                          value={reasons[line.id] ?? ''}
                          onChange={(e) =>
                            setReasons((r) => ({ ...r, [line.id]: e.target.value }))
                          }
                        />
                        <div className="rfm-outcome-actions">
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={busyLine === line.id || certBlocked}
                            onClick={() => record(line, 'boarded')}
                          >
                            Boarded
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busyLine === line.id}
                            onClick={() => record(line, 'dropped')}
                          >
                            Dropped
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busyLine === line.id}
                            onClick={() => record(line, 'no_show')}
                          >
                            No-show
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Modal>
  )
}
