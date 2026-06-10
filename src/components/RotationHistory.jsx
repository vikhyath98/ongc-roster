import { useEffect, useState } from 'react'
import { listEmployeeRotations } from '../lib/employees'
import { daysInclusive, todayISO } from '../lib/dates'

// Read-only rotation history for one employee (most recent first).
export default function RotationHistory({ employeeId, maxServiceDays = 70 }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setRows(null)
    listEmployeeRotations(employeeId).then(({ data, error: err }) => {
      if (!active) return
      if (err) setError(err.message)
      else setRows(data ?? [])
    })
    return () => {
      active = false
    }
  }, [employeeId])

  if (error) return <p className="banner banner--error">{error}</p>
  if (rows === null) return <p className="muted">Loading history…</p>
  if (rows.length === 0) return <p className="muted">No rotation history yet.</p>

  return (
    <ul className="rot-history">
      {rows.map((r) => {
        const offshore = !r.sign_off_date
        const days = daysInclusive(r.sign_on_date, r.sign_off_date || todayISO())
        const over = Math.max(0, days - maxServiceDays)
        return (
          <li key={r.id} className={'rot-row' + (over > 0 ? ' rot-row--over' : '')}>
            <div className="rot-row__main">
              <span className="rot-row__site">📍 {r.installation?.name ?? '—'}</span>
              <span className="rot-row__dates">
                {r.sign_on_date} →{' '}
                {offshore ? <em>Currently offshore</em> : r.sign_off_date}
              </span>
            </div>
            <div className="rot-row__side">
              <span className={'pill ' + (offshore ? 'state--teal' : 'pill--muted')}>
                {offshore ? 'Offshore' : 'Completed'}
              </span>
              <span className="rot-row__days">
                <strong>{days}</strong>d
                {over > 0 && <span className="rot-row__over"> · {over}d over</span>}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
