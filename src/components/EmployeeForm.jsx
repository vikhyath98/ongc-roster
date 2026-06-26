import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { createEmployee, updateEmployee, onboardEmployee } from '../lib/employees'
import { uploadEmployeePhoto, getSignedUrl } from '../lib/storage'
import { useAuth } from '../context/AuthContext'
import { todayISO, addDays } from '../lib/dates'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5 MB

const EMPTY = {
  emp_id: '',
  full_name: '',
  designation_id: '',
  phone: '',
  alternate_phone: '',
  employment_status: 'active',
  notes: '',
  base_location_type: '', // '' = not specified → null on save
  recall_lead_time_days: '', // '' → null on save
  nedp_number: '', // '' → null on save
  nedp_valid_until: '', // '' → null on save
  location_id: '', // '' = on base
  sign_on_date: '',
}

// Add/edit an employee. `employee` null => add mode.
// Location can be set on entry for staff already offshore: choosing an
// installation also captures a sign-on date and opens a rotation stint, so
// day-counting and penalties are correct (SPEC.md §5.4, §6.1).
export default function EmployeeForm({
  open,
  employee,
  designations,
  installations = [],
  maxServiceDays = 70,
  onClose,
  onSaved,
}) {
  const { user } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Identity photo (edit mode only). Uploaded immediately on file select, not on
  // form save — so we track the path/signed-URL separately from `form`.
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoPath, setPhotoPath] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoErr, setPhotoErr] = useState('')
  const photoInputRef = useRef(null)

  // Reset the form whenever the modal opens or the target employee changes.
  // (Done in an effect, not during render, to avoid an add-mode render loop.)
  useEffect(() => {
    if (!open) return
    setForm(
      employee
        ? {
            emp_id: employee.emp_id ?? '',
            full_name: employee.full_name ?? '',
            designation_id: employee.designation_id ?? '',
            phone: employee.phone ?? '',
            alternate_phone: employee.alternate_phone ?? '',
            employment_status: employee.employment_status ?? 'active',
            notes: employee.notes ?? '',
            base_location_type: employee.base_location_type ?? '',
            recall_lead_time_days: employee.recall_lead_time_days ?? '',
            nedp_number: employee.nedp_number ?? '',
            nedp_valid_until: employee.nedp_valid_until ?? '',
            location_id: employee.current_installation_id ?? '',
            sign_on_date: todayISO(),
          }
        : { ...EMPTY, sign_on_date: todayISO() }
    )
    setError('')
  }, [open, employee])

  // Load the current photo's signed URL when the form opens for an existing
  // employee. Cleared for add-mode (no photo until the row exists).
  useEffect(() => {
    setPhotoErr('')
    if (!open || !employee?.id) {
      setPhotoUrl(null)
      setPhotoPath(null)
      return
    }
    setPhotoPath(employee.photo_path ?? null)
    if (!employee.photo_path) {
      setPhotoUrl(null)
      return
    }
    let active = true
    getSignedUrl(employee.photo_path).then((u) => {
      if (active) setPhotoUrl(u)
    })
    return () => {
      active = false
    }
  }, [open, employee?.id, employee?.photo_path])

  async function onPhotoSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again after an error
    if (!file) return
    setPhotoErr('')
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoErr('File too large (max 5 MB)')
      return
    }
    setPhotoBusy(true)
    const { path, error: upErr } = await uploadEmployeePhoto(employee.id, file)
    if (upErr || !path) {
      setPhotoBusy(false)
      setPhotoErr('Upload failed, try again.')
      return
    }
    setPhotoPath(path)
    setPhotoUrl(await getSignedUrl(path))
    setPhotoBusy(false)
  }

  const isEdit = Boolean(employee)
  // Already offshore => location is managed via the Boarding flow, not here.
  const isOffshore = isEdit && Boolean(employee?.current_installation_id)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const expectedRotation = form.sign_on_date
    ? addDays(form.sign_on_date, maxServiceDays)
    : ''

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.emp_id.trim() || !form.full_name.trim() || !form.designation_id) {
      setError('Employee ID, name and designation are required.')
      return
    }
    const willOnboard = !isOffshore && Boolean(form.location_id)
    if (willOnboard && !form.sign_on_date) {
      setError('Enter the sign-on date for the chosen location.')
      return
    }

    setBusy(true)
    const { data, error: saveErr } = isEdit
      ? await updateEmployee(employee.id, form)
      : await createEmployee(form)
    if (saveErr) {
      setBusy(false)
      setError(saveErr.message)
      return
    }

    if (willOnboard) {
      const { error: onboardErr } = await onboardEmployee(
        data.id,
        {
          installationId: form.location_id,
          signOnDate: form.sign_on_date,
          expectedRotationDate: expectedRotation,
        },
        user?.id
      )
      if (onboardErr) {
        setBusy(false)
        setError(`Employee saved, but onboarding failed: ${onboardErr.message}`)
        onSaved?.(data)
        return
      }
    }

    setBusy(false)
    onSaved?.(data)
    onClose?.()
  }

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit employee' : 'Add employee'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="employee-form" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}
          </button>
        </>
      }
    >
      <form id="employee-form" onSubmit={handleSubmit} className="form-grid">
        {/* Identity photo — edit mode only; uploads immediately on select. */}
        {isEdit && (
          <div className="photo-edit">
            {photoUrl ? (
              <img className="avatar" style={{ width: 60, height: 60 }} src={photoUrl} alt="Employee photo" />
            ) : (
              <span className="avatar avatar--ph" style={{ width: 60, height: 60 }} aria-hidden="true">
                📷
              </span>
            )}
            <div className="photo-edit__body">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoBusy}
              >
                {photoBusy ? 'Uploading…' : photoPath ? 'Change photo' : 'Add photo'}
              </button>
              {photoErr && <span className="photo-edit__err">{photoErr}</span>}
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/heic"
              hidden
              onChange={onPhotoSelect}
            />
          </div>
        )}

        <label className="field">
          <span>Employee ID *</span>
          <input
            value={form.emp_id}
            onChange={(e) => setForm((f) => ({ ...f, emp_id: e.target.value.toUpperCase() }))}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>Full name *</span>
          <input value={form.full_name} onChange={set('full_name')} />
        </label>

        <label className="field">
          <span>Designation *</span>
          <select value={form.designation_id} onChange={set('designation_id')}>
            <option value="">Select…</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.category?.name ? ` — ${d.category.name}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Phone</span>
          <input value={form.phone} onChange={set('phone')} inputMode="tel" />
        </label>

        <label className="field">
          <span>Alternate phone (optional)</span>
          <input value={form.alternate_phone} onChange={set('alternate_phone')} inputMode="tel" />
        </label>

        {/* Location */}
        {isOffshore ? (
          <div className="field">
            <span>Current location</span>
            <p className="field-readonly">
              📍 {employee.installation?.name ?? 'Offshore'} — manage moves in the Boarding screen.
            </p>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Current location</span>
              <select value={form.location_id} onChange={set('location_id')}>
                <option value="">On base</option>
                {installations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.type})
                  </option>
                ))}
              </select>
            </label>

            {form.location_id && (
              <>
                <label className="field">
                  <span>Sign-on date * (when they boarded)</span>
                  <input type="date" value={form.sign_on_date} onChange={set('sign_on_date')} />
                </label>
                <p className="field-hint muted">
                  Opens a rotation record. Expected rotation:{' '}
                  <strong>{expectedRotation || '—'}</strong> (sign-on + {maxServiceDays} days).
                </p>
              </>
            )}
          </>
        )}

        <label className="field">
          <span>Employment status</span>
          <select value={form.employment_status} onChange={set('employment_status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>

        <label className="field">
          <span>Base location type</span>
          <select value={form.base_location_type} onChange={set('base_location_type')}>
            <option value="">Not specified</option>
            <option value="guesthouse">Guesthouse</option>
            <option value="hometown">Out of town</option>
          </select>
        </label>

        <label className="field">
          <span>Recall lead time (days)</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="e.g. 2"
            value={form.recall_lead_time_days}
            onChange={set('recall_lead_time_days')}
          />
        </label>

        <label className="field">
          <span>NEDP number</span>
          <input
            value={form.nedp_number}
            onChange={set('nedp_number')}
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>NEDP valid until</span>
          <input type="date" value={form.nedp_valid_until} onChange={set('nedp_valid_until')} />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={form.notes} onChange={set('notes')} />
        </label>

        {error && <p className="banner banner--error">{error}</p>}
      </form>
    </Modal>
  )
}
