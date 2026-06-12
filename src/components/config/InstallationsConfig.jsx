import { useEffect, useState } from 'react'
import { listInstallations } from '../../lib/reference'
import { createInstallation, updateInstallation } from '../../lib/configAdmin'
import Modal from '../Modal'

export default function InstallationsConfig() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('platform')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    setLoading(true)
    const { data, error: err } = await listInstallations()
    if (err) setError(err.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    setName('')
    setType('platform')
    setFormError('')
    setFormOpen(true)
  }
  function openEdit(it) {
    setEditing(it)
    setName(it.name)
    setType(it.type)
    setFormError('')
    setFormOpen(true)
  }

  async function toggleActive(it) {
    const { data, error: err } = await updateInstallation(it.id, { is_active: !it.is_active })
    if (err) {
      setError(err.message)
      return
    }
    setItems((list) => list.map((x) => (x.id === it.id ? data : x)))
  }

  async function save() {
    setFormError('')
    if (!name.trim()) {
      setFormError('Name is required.')
      return
    }
    setBusy(true)
    const { error: err } = editing
      ? await updateInstallation(editing.id, { name, type })
      : await createInstallation({ name, type })
    setBusy(false)
    if (err) {
      setFormError(err.message)
      return
    }
    setFormOpen(false)
    load()
  }

  if (loading) return <p className="muted">Loading…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  return (
    <div>
      <div className="toolbar">
        <span className="muted list-count">{items.length} installations</span>
        <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
          ＋ Add
        </button>
      </div>

      <p className="banner banner--info">
        Installations are never deleted — rotation history is tied to them. Toggle one to{' '}
        <strong>Deactivated</strong> to retire it: deactivated installations are hidden from
        boarding and replacement, but their history is preserved.
      </p>

      <ul className="config-list">
        {items.map((it) => (
          <li key={it.id} className="config-row">
            <div className="config-row__main">
              <span className="config-row__title">
                {it.name}{' '}
                {!it.is_active && <span className="pill pill--muted">Deactivated</span>}
              </span>
              <span className="config-row__sub">
                {it.type} · {it.is_active ? 'Active' : 'Deactivated'}
              </span>
            </div>
            <div className="config-row__actions">
              <label
                className="switch"
                title={
                  it.is_active
                    ? 'Active — tap to deactivate (hides from boarding/replacement, keeps history)'
                    : 'Deactivated — tap to reactivate'
                }
              >
                <input type="checkbox" checked={it.is_active} onChange={() => toggleActive(it)} />
                <span className="switch__track" />
              </label>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(it)}>
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={formOpen}
        title={editing ? 'Edit installation' : 'Add installation'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field">
            <span>Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="platform">Platform</option>
              <option value="rig">Rig</option>
            </select>
          </label>
          {formError && <p className="banner banner--error">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
