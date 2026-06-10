import { useEffect, useMemo, useState } from 'react'
import { loadCandidates, reservePool } from '../lib/reserve'
import { daysBetween, todayISO } from '../lib/dates'

function expiryInfo(av) {
  if (!av?.expires_at) return null
  const iso = av.expires_at.slice(0, 10)
  const left = daysBetween(todayISO(), iso)
  return { date: iso, left }
}

export default function Reserve() {
  const [pool, setPool] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fDesig, setFDesig] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const { candidates, error: err } = await loadCandidates()
      if (err) setError(err.message)
      else setPool(reservePool(candidates))
      setLoading(false)
    })()
  }, [])

  const desigOptions = useMemo(() => {
    const m = new Map()
    for (const c of pool) if (c.designation) m.set(c.designation.id, c.designation)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [pool])

  const shown = useMemo(
    () => (fDesig ? pool.filter((c) => c.designation_id === fDesig) : pool),
    [pool, fDesig]
  )

  return (
    <section>
      {loading && <p className="muted">Loading reserve pool…</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {!loading && !error && (
        <>
          <p className="banner banner--info">
            ✅ Ready to deploy — eligible, fully certified, and with a live (unexpired)
            confirmation.
          </p>

          {pool.length > 0 && (
            <label className="field roster-filters">
              <span>Designation</span>
              <select value={fDesig} onChange={(e) => setFDesig(e.target.value)}>
                <option value="">All designations</option>
                {desigOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <p className="list-count muted">
            {fDesig ? `${shown.length} of ${pool.length}` : pool.length} ready
          </p>

          {pool.length === 0 ? (
            <p className="muted empty-state">
              Nobody is confirmed and ready yet. Use the Replacement finder to call and
              confirm base staff.
            </p>
          ) : shown.length === 0 ? (
            <p className="muted empty-state">No reserve staff for this designation.</p>
          ) : (
            <ul className="card-list">
              {shown.map((c) => {
                const exp = expiryInfo(c.availability)
                return (
                  <li key={c.id}>
                    <div className="roster-card state--teal">
                      <div className="emp-card__main">
                        <span className="emp-card__name">{c.full_name}</span>
                        <span className="emp-card__meta">
                          {c.emp_id} · {c.designation?.name ?? '—'}
                        </span>
                        <span className="reserve-sub">
                          {c.restDays === null ? 'No prior offshore' : `${c.restDays}d rest`} ·{' '}
                          {c.availability?.call_count ?? 0} call
                          {(c.availability?.call_count ?? 0) === 1 ? '' : 's'}
                          {c.availability?.confirmed_for_date
                            ? ` · for ${c.availability.confirmed_for_date}`
                            : ''}
                        </span>
                      </div>
                      <div className="emp-card__side">
                        <span className="pill pill--ok">Confirmed</span>
                        {exp && (
                          <span className={`pill ${exp.left <= 3 ? 'pill--warn' : ''}`}>
                            until {exp.date}
                            {exp.left >= 0 ? ` (${exp.left}d)` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
