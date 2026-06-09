import Modal from './Modal'
import EmployeeDocChecklist from './EmployeeDocChecklist'
import { computeCertStatus } from '../lib/documents'
import { useAuth } from '../context/AuthContext'

// Read view of one employee: identity, cert-current summary, and the
// editable document checklist. "Edit details" hands off to EmployeeForm.
export default function EmployeeDetail({
  open,
  employee,
  docTypes,
  employeeDocs,
  onEdit,
  onClose,
  onDocsChanged,
}) {
  const { user } = useAuth()
  if (!employee) return null

  const cert = computeCertStatus(employee.designation_id, docTypes, employeeDocs)

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
          <span className="detail-meta__value">
            {employee.employment_status === 'active' ? 'Active' : 'Inactive'}
          </span>
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
    </Modal>
  )
}
