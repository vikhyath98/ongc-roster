import { useEffect, useMemo, useState } from 'react'
import { listInstallations, listDesignations } from '../../lib/reference'
import {
  listInstallationRequirements,
  upsertRequirement,
  deleteRequirement,
} from '../../lib/configAdmin'

export default function RequirementsConfig() {
  const [installations, setInstallations] = useState([])
  const [designations, setDesignations] = useState([])
  const [requirements, setRequirements] = useState([])
  const [installationId, setInstallationId] = useState('')
  const [counts, setCounts] = useState({}) // designation_id -> string
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function loadAll() {
    setLoading(true)
    const [inst, des, req] = await Promise.all([
      listInstallations(),
      listDesignations(),
      listInstallationRequirements(),
    ])
    if (inst.error) setError(inst.error.message)
    else setInstallations(inst.data ?? [])
    if (!des.error) setDesignations(des.data ?? [])
    if (!req.error) setRequirements(req.data ?? [])
    if (!installationId && inst.data?.length) setInstallationId(inst.data[0].id)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Existing required_count for the selected installation, by designation.
  const original = useMemo(() => {
    const m = {}
    for (const r of requirements) {
      if (r.installation_id === installationId) m[r.designation_id] = r.required_count
    }
    return m
  }, [requirements, installationId])

  // Reset the editable counts whenever the installation or data changes.
  useEffect(() => {
    const next = {}
    for (const d of designations) next[d.id] = String(original[d.id] ?? 0)
    setCounts(next)
    setMsg('')
  }, [installationId, designations, original])

  const changed = designations.filter(
    (d) => Number(counts[d.id] || 0) !== Number(original[d.id] ?? 0)
  )

  async function save() {
    setError('')
    setMsg('')
    setBusy(true)
    for (const d of changed) {
      const desired = Number(counts[d.id] || 0)
      const existed = original[d.id] !== undefined
      const res =
        desired === 0 && existed
          ? await deleteRequirement(installationId, d.id)
          : await upsertRequirement(installationId, d.id, desired)
      if (res.error) {
        setBusy(false)
        setError(res.error.message)
        return
      }
    }
    setBusy(false)
    setMsg(`Saved ${changed.length} change${changed.length === 1 ? '' : 's'}.`)
    const { data } = await listInstallationRequirements()
    setRequirements(data ?? [])
  }

  if (loading) return <p className="muted">Loading…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  const totalNeeded = designations.reduce((s, d) => s + Number(counts[d.id] || 0), 0)

  return (
    <div className="form-grid">
      <label className="field">
        <span>Installation</span>
        <select value={installationId} onChange={(e) => setInstallationId(e.target.value)}>
          {installations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.type}){i.is_active ? '' : ' — inactive'}
            </option>
          ))}
        </select>
      </label>

      <p className="muted">Set how many of each designation this installation needs. Total: <strong>{totalNeeded}</strong></p>

      <ul className="config-list">
        {designations.map((d) => (
          <li key={d.id} className="config-row">
            <div className="config-row__main">
              <span className="config-row__title">{d.name}</span>
              <span className="config-row__sub">{d.category?.name ?? ''}</span>
            </div>
            <input
              type="number"
              min="0"
              className="req-input"
              value={counts[d.id] ?? '0'}
              onChange={(e) => setCounts((c) => ({ ...c, [d.id]: e.target.value }))}
            />
          </li>
        ))}
      </ul>

      {msg && <p className="banner banner--info">{msg}</p>}

      <button type="button" className="btn btn--primary" disabled={busy || changed.length === 0} onClick={save}>
        {busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Saved'}
      </button>
    </div>
  )
}
