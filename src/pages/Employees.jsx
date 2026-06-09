import { useEffect, useMemo, useState } from 'react'
import { listEmployees } from '../lib/employees'
import { listDesignations, listInstallations } from '../lib/reference'
import { listDocumentTypes, listAllEmployeeDocuments, computeCertStatus } from '../lib/documents'
import { getAppConfig, configInt } from '../lib/config'
import EmployeeForm from '../components/EmployeeForm'
import EmployeeDetail from '../components/EmployeeDetail'
import EmployeeImport from '../components/EmployeeImport'

export default function Employees() {
  const [employees, setEmployees] = useState([])
  const [designations, setDesignations] = useState([])
  const [installations, setInstallations] = useState([])
  const [maxServiceDays, setMaxServiceDays] = useState(70)
  const [docTypes, setDocTypes] = useState([])
  const [allDocs, setAllDocs] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detail, setDetail] = useState(null)
  const [importOpen, setImportOpen] = useState(false)

  async function load() {
    setLoading(true)
    const [emp, des, inst, dts, eds, cfg] = await Promise.all([
      listEmployees(),
      listDesignations(),
      listInstallations({ activeOnly: true }),
      listDocumentTypes(),
      listAllEmployeeDocuments(),
      getAppConfig(),
    ])
    if (emp.error) setError(emp.error.message)
    else setEmployees(emp.data ?? [])
    if (!des.error) setDesignations(des.data ?? [])
    if (!inst.error) setInstallations(inst.data ?? [])
    if (!dts.error) setDocTypes(dts.data ?? [])
    if (!eds.error) setAllDocs(eds.data ?? [])
    if (!cfg.error) setMaxServiceDays(configInt(cfg.config, 'max_service_days', 70))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Group documents by employee once, for cert badges.
  const docsByEmployee = useMemo(() => {
    const m = new Map()
    for (const d of allDocs) {
      if (!m.has(d.employee_id)) m.set(d.employee_id, [])
      m.get(d.employee_id).push(d)
    }
    return m
  }, [allDocs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      [e.full_name, e.emp_id, e.designation?.name]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    )
  }, [employees, query])

  function openAdd() {
    setEditing(null)
    setFormOpen(true)
  }
  function openDetail(emp) {
    setDetail(emp)
  }
  function editFromDetail(emp) {
    setDetail(null)
    setEditing(emp)
    setFormOpen(true)
  }
  function handleSaved() {
    load()
  }

  // Keep the open detail modal pointed at fresh data after a reload.
  const detailEmployee = detail
    ? employees.find((e) => e.id === detail.id) ?? detail
    : null

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search name, ID or designation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
          ＋ Add
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setImportOpen(true)}
        >
          ⬆ Import
        </button>
      </div>

      {loading && <p className="muted">Loading employees…</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {!loading && !error && (
        <>
          <p className="list-count muted">
            {filtered.length} of {employees.length} employee
            {employees.length === 1 ? '' : 's'}
          </p>

          {filtered.length === 0 ? (
            <p className="muted empty-state">
              {employees.length === 0
                ? 'No employees yet. Tap ＋ Add, or use bulk import.'
                : 'No matches for your search.'}
            </p>
          ) : (
            <ul className="card-list">
              {filtered.map((e) => {
                const cert = computeCertStatus(
                  e.designation_id,
                  docTypes,
                  docsByEmployee.get(e.id) ?? []
                )
                return (
                  <li key={e.id}>
                    <button type="button" className="emp-card" onClick={() => openDetail(e)}>
                      <div className="emp-card__main">
                        <span className="emp-card__name">{e.full_name}</span>
                        <span className="emp-card__meta">
                          {e.emp_id} · {e.designation?.name ?? 'No designation'}
                        </span>
                      </div>
                      <div className="emp-card__side">
                        {e.employment_status === 'inactive' && (
                          <span className="pill pill--muted">Inactive</span>
                        )}
                        <span className={`pill ${cert.certCurrent ? 'pill--ok' : 'pill--bad'}`}>
                          {cert.certCurrent ? 'Certs OK' : `${cert.problems.length} cert issue${cert.problems.length === 1 ? '' : 's'}`}
                        </span>
                        <span className="pill">
                          {e.installation ? `📍 ${e.installation.name}` : 'On base'}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <EmployeeDetail
        open={Boolean(detailEmployee)}
        employee={detailEmployee}
        docTypes={docTypes}
        employeeDocs={detailEmployee ? docsByEmployee.get(detailEmployee.id) ?? [] : []}
        onEdit={editFromDetail}
        onClose={() => setDetail(null)}
        onDocsChanged={load}
      />

      <EmployeeForm
        open={formOpen}
        employee={editing}
        designations={designations}
        installations={installations}
        maxServiceDays={maxServiceDays}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />

      <EmployeeImport
        open={importOpen}
        designations={designations}
        existingEmpIds={employees.map((e) => e.emp_id)}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />
    </section>
  )
}
