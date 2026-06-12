import { useEffect, useState } from 'react'
import { listDesignations, listCategories } from '../../lib/reference'
import {
  createDesignation,
  updateDesignation,
  deleteDesignation,
  countEmployeesByDesignation,
} from '../../lib/configAdmin'
import Modal from '../Modal'

export default function DesignationsConfig() {
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [counts, setCounts] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteFor, setDeleteFor] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  async function load() {
    setLoading(true)
    const [des, cat, cnt] = await Promise.all([
      listDesignations(),
      listCategories(),
      countEmployeesByDesignation(),
    ])
    if (des.error) setError(des.error.message)
    else setItems(des.data ?? [])
    if (!cat.error) setCategories(cat.data ?? [])
    if (!cnt.error) setCounts(cnt.counts)
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

  function openDelete(d) {
    setDeleteFor(d)
    setDeleteError('')
  }

  async function doDelete() {
    setBusy(true)
    setDeleteError('')
    const { error: err } = await deleteDesignation(deleteFor.id)
    setBusy(false)
    if (err) {
      setDeleteError(err.message)
      return
    }
    setDeleteFor(null)
    load()
  }

  const deleteCount = deleteFor ? counts.get(deleteFor.id) ?? 0 : 0

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
        {items.map((d) => {
          const n = counts.get(d.id) ?? 0
          return (
            <li key={d.id} className="config-row">
              <div className="config-row__main">
                <span className="config-row__title">{d.name}</span>
                <span className="config-row__sub">
                  {d.category?.name ?? '—'} · {n} employee{n === 1 ? '' : 's'}
                </span>
              </div>
              <div className="config-row__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(d)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => openDelete(d)}
                  title={n > 0 ? `${n} employee(s) use this designation` : 'Delete'}
                >
                  Delete
                </button>
              </div>
            </li>
          )
        })}
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

      <Modal
        open={Boolean(deleteFor)}
        title="Delete designation"
        onClose={() => setDeleteFor(null)}
        footer={
          deleteCount > 0 ? (
            <button type="button" className="btn btn--primary" onClick={() => setDeleteFor(null)}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setDeleteFor(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--danger" disabled={busy} onClick={doDelete}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )
        }
      >
        {deleteFor &&
          (deleteCount > 0 ? (
            <p className="banner banner--error">
              Cannot delete — {deleteCount} employee{deleteCount === 1 ? '' : 's'} use this
              designation. Set them to a different designation first.
            </p>
          ) : (
            <p>
              Permanently delete <strong>{deleteFor.name}</strong>? No employees use it. This cannot
              be undone.
            </p>
          ))}
        {deleteError && <p className="banner banner--error">{deleteError}</p>}
      </Modal>
    </div>
  )
}
