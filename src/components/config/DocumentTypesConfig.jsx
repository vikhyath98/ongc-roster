import { useEffect, useMemo, useState } from 'react'
import { listDocumentTypes } from '../../lib/documents'
import { listDesignations } from '../../lib/reference'
import {
  createDocumentType,
  updateDocumentType,
  setDocTypeDesignations,
} from '../../lib/configAdmin'
import Modal from '../Modal'

export default function DocumentTypesConfig() {
  const [items, setItems] = useState([])
  const [designations, setDesignations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  // form state
  const [name, setName] = useState('')
  const [isRequired, setIsRequired] = useState(true)
  const [appliesToAll, setAppliesToAll] = useState(true)
  const [tracksDates, setTracksDates] = useState(true)
  const [validity, setValidity] = useState('')
  const [desigIds, setDesigIds] = useState(new Set())

  async function load() {
    setLoading(true)
    const [dts, des] = await Promise.all([listDocumentTypes(), listDesignations()])
    if (dts.error) setError(dts.error.message)
    else setItems(dts.data ?? [])
    if (!des.error) setDesignations(des.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const desigName = useMemo(
    () => new Map(designations.map((d) => [d.id, d.name])),
    [designations]
  )

  function openAdd() {
    setEditing(null)
    setName('')
    setIsRequired(true)
    setAppliesToAll(true)
    setTracksDates(true)
    setValidity('')
    setDesigIds(new Set())
    setFormError('')
    setFormOpen(true)
  }
  function openEdit(dt) {
    setEditing(dt)
    setName(dt.name)
    setIsRequired(dt.is_required)
    setAppliesToAll(dt.applies_to_all)
    setTracksDates(dt.tracks_dates !== false)
    setValidity(dt.default_validity_days ?? '')
    setDesigIds(new Set((dt.document_type_designations ?? []).map((m) => m.designation_id)))
    setFormError('')
    setFormOpen(true)
  }

  function toggleDesig(id) {
    setDesigIds((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function save() {
    setFormError('')
    if (!name.trim()) {
      setFormError('Name is required.')
      return
    }
    if (!appliesToAll && desigIds.size === 0) {
      setFormError('Pick at least one designation, or make it universal.')
      return
    }
    setBusy(true)
    const fields = {
      name,
      is_required: isRequired,
      applies_to_all: appliesToAll,
      tracks_dates: tracksDates,
      default_validity_days: validity === '' ? null : Number(validity),
    }
    const { data, error: err } = editing
      ? await updateDocumentType(editing.id, fields)
      : await createDocumentType(fields)
    if (err) {
      setBusy(false)
      setFormError(err.message)
      return
    }
    // Universal docs carry no mappings; specific docs carry the chosen set.
    const { error: mapErr } = await setDocTypeDesignations(
      data.id,
      appliesToAll ? [] : [...desigIds]
    )
    setBusy(false)
    if (mapErr) {
      setFormError(mapErr.message)
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
        <span className="muted list-count">{items.length} document types</span>
        <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
          ＋ Add
        </button>
      </div>

      <ul className="config-list">
        {items.map((dt) => {
          const mapped = (dt.document_type_designations ?? []).map((m) => desigName.get(m.designation_id)).filter(Boolean)
          return (
            <li key={dt.id} className="config-row">
              <div className="config-row__main">
                <span className="config-row__title">{dt.name}</span>
                <span className="config-row__sub">
                  {dt.applies_to_all ? 'Universal' : `Specific: ${mapped.join(', ') || '—'}`}
                  {dt.default_validity_days ? ` · ${dt.default_validity_days}d validity` : ''}
                  {dt.tracks_dates === false ? ' · no dates' : ''}
                  {!dt.is_required ? ' · optional' : ''}
                </span>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(dt)}>
                Edit
              </button>
            </li>
          )
        })}
      </ul>

      <Modal
        open={formOpen}
        title={editing ? 'Edit document type' : 'Add document type'}
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

          <label className="checkrow">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            <span>Required (counts toward cert-current)</span>
          </label>

          <label className="checkrow">
            <input type="checkbox" checked={tracksDates} onChange={(e) => setTracksDates(e.target.checked)} />
            <span>Tracks issue/expiry dates (off for ID numbers like Aadhaar/PAN)</span>
          </label>

          {tracksDates && (
            <label className="field">
              <span>Default validity (days, optional)</span>
              <input
                type="number"
                min="0"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                placeholder="e.g. 365"
              />
            </label>
          )}

          <label className="checkrow">
            <input
              type="checkbox"
              checked={appliesToAll}
              onChange={(e) => setAppliesToAll(e.target.checked)}
            />
            <span>Universal — required of every employee</span>
          </label>

          {!appliesToAll && (
            <div className="field">
              <span>Applies to designations</span>
              <div className="chip-group">
                {designations.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={'chip' + (desigIds.has(d.id) ? ' chip--on' : '')}
                    onClick={() => toggleDesig(d.id)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {formError && <p className="banner banner--error">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
