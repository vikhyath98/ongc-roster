import { useEffect, useMemo, useState } from 'react'
import { listOffshoreStints } from '../lib/boarding'
import { getAppConfig, configInt } from '../lib/config'
import { daysInclusive } from '../lib/dates'
import { rotationState } from '../lib/rotation'

export default function Roster() {
  const [stints, setStints] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [stintRes, cfgRes] = await Promise.all([listOffshoreStints(), getAppConfig()])
      if (stintRes.error) setError(stintRes.error.message)
      else setStints(stintRes.data ?? [])
      if (!cfgRes.error) {
        setThresholds({
          min: configInt(cfgRes.config, 'min_service_days', 56),
          warning: configInt(cfgRes.config, 'warning_day', 65),
          max: configInt(cfgRes.config, 'max_service_days', 70),
        })
      }
      setLoading(false)
    })()
  }, [])

  // Decorate each stint with days served + colour state, then group by site.
  const groups = useMemo(() => {
    const decorated = stints.map((s) => {
      const days = daysInclusive(s.sign_on_date)
      return { ...s, days, state: rotationState(days, thresholds) }
    })
    const byInstall = new Map()
    for (const s of decorated) {
      const key = s.installation?.id ?? 'unknown'
      if (!byInstall.has(key)) {
        byInstall.set(key, { installation: s.installation, people: [] })
      }
      byInstall.get(key).people.push(s)
    }
    const list = [...byInstall.values()]
    // Sort installations by name; within each, most days served first.
    list.sort((a, b) => (a.installation?.name ?? '').localeCompare(b.installation?.name ?? ''))
    for (const g of list) g.people.sort((a, b) => b.days - a.days)
    return list
  }, [stints, thresholds])

  const total = stints.length

  return (
    <section>
      {loading && <p className="muted">Loading roster…</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {!loading && !error && (
        <>
          <p className="list-count muted">
            {total} offshore across {groups.length} installation{groups.length === 1 ? '' : 's'}
          </p>

          {total === 0 ? (
            <p className="muted empty-state">Nobody is offshore right now.</p>
          ) : (
            groups.map((g) => {
              const over = g.people.filter((p) => p.state.key === 'over').length
              const warn = g.people.filter((p) => p.state.key === 'warning').length
              return (
                <div className="roster-group" key={g.installation?.id ?? 'unknown'}>
                  <div className="roster-group__head">
                    <h3 className="roster-group__title">
                      {g.installation?.name ?? 'Unknown'}{' '}
                      <span className="muted">({g.installation?.type})</span>
                    </h3>
                    <span className="roster-group__count">
                      {g.people.length}
                      {over > 0 && <span className="dot dot--red"> ● {over} over</span>}
                      {warn > 0 && <span className="dot dot--amber"> ● {warn} warning</span>}
                    </span>
                  </div>

                  <ul className="card-list">
                    {g.people.map((p) => (
                      <li key={p.id}>
                        <div className={`roster-card ${p.state.cls}`}>
                          <div className="emp-card__main">
                            <span className="emp-card__name">{p.employee?.full_name ?? '—'}</span>
                            <span className="emp-card__meta">
                              {p.employee?.emp_id} · {p.employee?.designation?.name ?? '—'}
                            </span>
                          </div>
                          <div className="roster-card__side">
                            <span className={`pill ${p.state.cls}`}>{p.state.label}</span>
                            <span className="roster-card__days">
                              <strong>{p.days}</strong>d
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })
          )}
        </>
      )}
    </section>
  )
}
