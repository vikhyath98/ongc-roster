import { useEffect, useState } from 'react'
import { listDesignations, listCategories } from '../../lib/reference'
import { createDesignation, updateDesignation } from '../../lib/configAdmin'
import Modal from '../Modal'

export default function DesignationsConfig() {
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    setLoading(true)
    const [des, cat] = await Promise.all([listDesignations(), listCategories()])
    if (des.error) setError(des.error.message)
    else setItems(des.data ?? [])
    if (!cat.error) setCategories(cat.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    setName('')
    setCategoryId(categories[0]?.id ?? '')
    setFormError('')
    setFormOpen(true)
  }
  function openEdit(d) {
    setEditing(d)
    setName(d.name)
    setCategoryId(d.category?.id ?? d.category_id ?? '')
    setFormError('')
    setFormOpen(true)
  }

  async function save() {
    setFormError('')
    if (!name.trim() || !categoryId) {
      setFormError('Name and category are required.')
      return
    }
    setBusy(true)
    const { error: err } = editing
      ? await updateDesignation(editing.id, { name, category_id: categoryId })
      : await createDesignation({ name, category_id: categoryId })
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
        <span className="muted list-count">{items.length} designations</span>
        <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
          ＋ Add
        </button>
      </div>

      <ul className="config-list">
        {items.map((d) => (
          <li key={d.id} className="config-row">
            <div className="config-row__main">
              <span className="config-row__title">{d.name}</span>
              <span className="config-row__sub">{d.category?.name ?? '—'}</span>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(d)}>
              Edit
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={formOpen}
        title={editing ? 'Edit designation' : 'Add designation'}
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
            <span>Category *</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {formError && <p className="banner banner--error">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
