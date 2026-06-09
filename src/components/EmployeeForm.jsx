import { useEffect, useState } from 'react'
import Modal from './Modal'
import { createEmployee, updateEmployee } from '../lib/employees'

const EMPTY = {
  emp_id: '',
  full_name: '',
  designation_id: '',
  phone: '',
  employment_status: 'active',
  notes: '',
}

// Add/edit an employee. `employee` null => add mode.
export default function EmployeeForm({ open, employee, designations, onClose, onSaved }) {
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
          }
        : EMPTY
    )
    setError('')
  }, [open, employee])

  const isEdit = Boolean(employee)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.emp_id.trim() || !form.full_name.trim() || !form.designation_id) {
      setError('Employee ID, name and designation are required.')
      return
    }
    setBusy(true)
    const { data, error: saveErr } = isEdit
      ? await updateEmployee(employee.id, form)
      : await createEmployee(form)
    setBusy(false)
    if (saveErr) {
      setError(saveErr.message)
      return
    }
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
          <button
            type="submit"
            form="employee-form"
            className="btn btn--primary"
            disabled={busy}
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}
          </button>
        </>
      }
    >
      <form id="employee-form" onSubmit={handleSubmit} className="form-grid">
        <label className="field">
          <span>Employee ID *</span>
          <input value={form.emp_id} onChange={set('emp_id')} autoCapitalize="characters" />
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
