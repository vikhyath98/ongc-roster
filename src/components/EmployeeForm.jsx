import { useEffect, useState } from 'react'
import Modal from './Modal'
import { createEmployee, updateEmployee, onboardEmployee } from '../lib/employees'
import { useAuth } from '../context/AuthContext'
import { todayISO, addDays } from '../lib/dates'

const EMPTY = {
  emp_id: '',
  full_name: '',
  designation_id: '',
  phone: '',
  employment_status: 'active',
  notes: '',
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
            employment_status: employee.employment_status ?? 'active',
            notes: employee.notes ?? '',
            location_id: employee.current_installation_id ?? '',
            sign_on_date: todayISO(),
          }
        : { ...EMPTY, sign_on_date: todayISO() }
    )
    setError('')
  }, [open, employee])

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
          <span>Notes</span>
          <textarea rows={3} value={form.notes} onChange={set('notes')} />
        </label>

        {error && <p className="banner banner--error">{error}</p>}
      </form>
    </Modal>
  )
}
