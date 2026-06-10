import { useEffect, useState } from 'react'
import Modal from './Modal'
import EmployeeDocChecklist from './EmployeeDocChecklist'
import { computeCertStatus } from '../lib/documents'
import { useAuth } from '../context/AuthContext'
import { employeeRotationCount, setEmploymentStatus, deleteEmployee } from '../lib/employees'

// Read view of one employee: identity, cert-current summary, the editable
// document checklist, and a Manage section (deactivate / smart hard delete).
export default function EmployeeDetail({
  open,
  employee,
  docTypes,
  employeeDocs,
  onEdit,
  onClose,
  onChanged,
  onDocsChanged,
}) {
  const { user } = useAuth()
  const [rotationCount, setRotationCount] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  // Look up rotation history each time the modal opens for an employee, to
  // decide whether a hard delete is permitted (only when there is none).
  useEffect(() => {
    setConfirmDelete(false)
    setError('')
    if (!open || !employee?.id) {
      setRotationCount(null)
      return
    }
    let active = true
    setRotationCount(null)
    employeeRotationCount(employee.id).then(({ count }) => {
      if (active) setRotationCount(count)
    })
    return () => {
      active = false
    }
  }, [open, employee?.id])

  if (!employee) return null

  const cert = computeCertStatus(employee.designation_id, docTypes, employeeDocs)
  const isActive = employee.employment_status === 'active'
  const hasHistory = rotationCount !== null && rotationCount > 0
  const canDelete = rotationCount === 0 // strictly no rotation history

  async function toggleStatus() {
    setBusy(true)
    setError('')
    const { error: err } = await setEmploymentStatus(
      employee.id,
      isActive ? 'inactive' : 'active'
    )
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onChanged?.()
  }

  async function doDelete() {
    setBusy(true)
    setError('')
    const { error: err } = await deleteEmployee(employee.id)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onChanged?.()
    onClose?.()
  }

  return (
    <Modal
      open={open}
      title={employee.full_name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onEdit(employee)}>
            Edit details
          </button>
        </>
      }
    >
      <div className="detail-meta">
        <div>
          <span className="detail-meta__label">Employee ID</span>
          <span className="detail-meta__value">{employee.emp_id}</span>
        </div>
        <div>
          <span className="detail-meta__label">Designation</span>
          <span className="detail-meta__value">
            {employee.designation?.name ?? '—'}
            {employee.designation?.category?.name
              ? ` · ${employee.designation.category.name}`
              : ''}
          </span>
        </div>
        <div>
          <span className="detail-meta__label">Phone</span>
          <span className="detail-meta__value">{employee.phone || '—'}</span>
        </div>
        <div>
          <span className="detail-meta__label">Location</span>
          <span className="detail-meta__value">
            {employee.installation ? `📍 ${employee.installation.name}` : 'On base'}
          </span>
        </div>
        <div>
          <span className="detail-meta__label">Status</span>
          <span className="detail-meta__value">{isActive ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      {employee.notes && <p className="detail-notes">{employee.notes}</p>}

      <div className={`cert-summary ${cert.certCurrent ? 'cert-summary--ok' : 'cert-summary--bad'}`}>
        {cert.certCurrent ? (
          <span>✅ Cert-current — all {cert.applicableCount} required documents verified</span>
        ) : (
          <div>
            <strong>⚠️ Not cert-current</strong>
            <ul className="cert-problems">
              {cert.problems.map((p) => (
                <li key={p.name}>
                  {p.name} — <em>{p.reason}</em>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h3 className="section-heading">Documents</h3>
      <EmployeeDocChecklist
        employee={employee}
        docTypes={docTypes}
        userId={user?.id}
        onChanged={onDocsChanged}
      />

      <h3 className="section-heading">Manage</h3>
      <div className="manage-box">
        <div className="manage-row">
          <div>
            <strong>{isActive ? 'Active' : 'Inactive'}</strong>
            <p className="muted manage-hint">
              {isActive
                ? 'Set inactive to remove from rosters, reserve pool and replacement finder. History is kept.'
                : 'Reactivate to include this employee in operations again.'}
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={toggleStatus} disabled={busy}>
            {isActive ? 'Set inactive' : 'Reactivate'}
          </button>
        </div>

        <div className="manage-divider" />

        {rotationCount === null ? (
          <p className="muted manage-hint">Checking rotation history…</p>
        ) : canDelete ? (
          confirmDelete ? (
            <div className="manage-confirm">
              <p>
                Permanently delete <strong>{employee.full_name}</strong>? This also removes
                their documents and call records. This cannot be undone.
              </p>
              <div className="manage-confirm__actions">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn btn--danger btn--sm" onClick={doDelete} disabled={busy}>
                  {busy ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          ) : (
            <div className="manage-row">
              <div>
                <strong>Delete permanently</strong>
                <p className="muted manage-hint">No rotation history — safe to remove (test/mistake).</p>
              </div>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete
              </button>
            </div>
          )
        ) : (
          <p className="muted manage-hint">
            🔒 Has rotation history ({rotationCount} stint{rotationCount === 1 ? '' : 's'}) — cannot
            be deleted. Use <strong>Set inactive</strong> instead.
          </p>
        )}

        {error && <p className="banner banner--error">{error}</p>}
      </div>
    </Modal>
  )
}
