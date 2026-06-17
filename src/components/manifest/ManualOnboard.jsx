import { useEffect, useMemo, useState } from 'react'
import { manualOnboard } from '../../lib/manifest'
import { listEmployees } from '../../lib/employees'
import { listInstallations } from '../../lib/reference'
import { listOffshoreStints } from '../../lib/boarding'
import { getAppConfig, configInt } from '../../lib/config'
import { todayISO, daysInclusive } from '../../lib/dates'
import Modal from '../Modal'

// Secondary escape hatch: board someone outside the Manifest → RFM flow (e.g.
// an ad hoc supply-boat ride). Reason is mandatory; an optional relief link
// opens a 'boarded' pairing directly.
export default function ManualOnboard({ open, userId, onClose, onDone }) {
  const [employees, setEmployees] = useState([])
  const [installations, setInstallations] = useState([])
  const [offshore, setOffshore] = useState([])
  const [cfg, setCfg] = useState({ maxServiceDays: 70, reliefGraceDays: 1 })

  const [employeeId, setEmployeeId] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [signOnDate, setSignOnDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [relieving, setRelieving] = useState(false)
  const [relievingId, setRelievingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setEmployeeId('')
    setInstallationId('')
    setSignOnDate(todayISO())
    setReason('')
    setRelieving(false)
    setRelievingId('')
    setBusy(false)
    setError('')
    ;(async () => {
      const [empRes, instRes, offRes, cfgRes] = await Promise.all([
        listEmployees(),
        listInstallations({ activeOnly: true }),
        listOffshoreStints(),
        getAppConfig(),
      ])
      if (!empRes.error)
        setEmployees(
          (empRes.data ?? []).filter(
            (e) => e.employment_status === 'active' && !e.current_installation_id
          )
        )
      if (!instRes.error) setInstallations(instRes.data ?? [])
      if (!offRes.error) setOffshore(offRes.data ?? [])
      if (!cfgRes.error)
        setCfg({
          maxServiceDays: configInt(cfgRes.config, 'max_service_days', 70),
          reliefGraceDays: configInt(cfgRes.config, 'relief_grace_period_days', 1),
        })
    })()
  }, [open])

  // Offshore staff at the chosen installation, as the relieved party.
  const offshoreHere = useMemo(
    () => offshore.filter((s) => s.installation_id === installationId),
    [offshore, installationId]
  )

  const canSubmit =
    employeeId &&
    installationId &&
    signOnDate &&
    reason.trim() &&
    (!relieving || relievingId) &&
    !busy

  async function submit() {
    setBusy(true)
    setError('')
    const { error: err } = await manualOnboard({
      employeeId,
      installationId,
      signOnDate,
      reason,
      relievingEmployeeId: relieving ? relievingId : null,
      userId,
      maxServiceDays: cfg.maxServiceDays,
      reliefGraceDays: cfg.reliefGraceDays,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onDone?.()
  }

  return (
    <Modal
      open={open}
      title="Manual onboard (exception)"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
            {busy ? 'Onboarding…' : 'Onboard'}
          </button>
        </>
      }
    >
      <p className="banner banner--warn">
        Boards someone outside the formal Manifest → RFM flow. A reason is required.
      </p>

      <label className="field">
        <span>Employee *</span>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select base staff…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name} — {e.designation?.name ?? '—'}
            </option>
          ))}
        </select>
      </label>

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

      <label className="field">
        <span>Reason * (required)</span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      <label className="checkrow">
        <input
          type="checkbox"
          checked={relieving}
          onChange={(e) => {
            setRelieving(e.target.checked)
            setRelievingId('')
          }}
        />
        <span>Is this person relieving someone currently offshore?</span>
      </label>

      {relieving && (
        <label className="field">
          <span>Relieving *</span>
          <select value={relievingId} onChange={(e) => setRelievingId(e.target.value)}>
            <option value="">Select offshore employee…</option>
            {offshoreHere.map((s) => (
              <option key={s.id} value={s.employee?.id}>
                {s.employee?.full_name} — {s.employee?.designation?.name ?? '—'} (
                {daysInclusive(s.sign_on_date)}d)
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="banner banner--error">{error}</p>}
    </Modal>
  )
}
