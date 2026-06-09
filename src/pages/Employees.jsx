import { useEffect, useMemo, useState } from 'react'
import { listEmployees } from '../lib/employees'
import { listDesignations } from '../lib/reference'
import EmployeeForm from '../components/EmployeeForm'

export default function Employees() {
  const [employees, setEmployees] = useState([])
  const [designations, setDesignations] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  async function load() {
    setLoading(true)
    const [emp, des] = await Promise.all([listEmployees(), listDesignations()])
    if (emp.error) setError(emp.error.message)
    else setEmployees(emp.data ?? [])
    if (!des.error) setDesignations(des.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

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
  function openEdit(emp) {
    setEditing(emp)
    setFormOpen(true)
  }

  function handleSaved() {
    load()
  }

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
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="emp-card"
                    onClick={() => openEdit(e)}
                  >
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
                      <span className="pill">
                        {e.installation ? `📍 ${e.installation.name}` : 'On base'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <EmployeeForm
        open={formOpen}
        employee={editing}
        designations={designations}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />
    </section>
  )
}
