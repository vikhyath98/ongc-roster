import { useEffect, useState } from 'react'
import { loadOngcHeadData } from '../lib/ongcHead'
import Modal from '../components/Modal'

// ONGC Head landing (SPEC.md §17.O). Read-only overview: a 14-card installation
// grid with rotation health, open penalty exposure, and expected dispute amount,
// plus a per-installation drill-down. No actions anywhere. Reachable only by the
// ongc_head role (gated via RoleRoute in Workstream M).

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const TYPE_LABEL = { platform: 'Platform', rig: 'Rig' }

// Manifest status pill for the drill-down (from classifyOffshoreEmployee).
const MANIFEST_PILL = {
  needs_manifest: { cls: 'pill--warn', label: 'Needs manifest' },
  filed: { cls: 'pill--muted', label: 'Filed / RFM' },
  boarded: { cls: 'pill--ok', label: 'Boarded' },
  retry: { cls: 'pill--bad', label: 'Retry needed' },
}

export default function OngcHeadView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // installation card or null

  useEffect(() => {
    let active = true
    ;(async () => {
      const { installations, updatedAt, error: e } = await loadOngcHeadData()
      if (!active) return
      if (e) setError(e.message)
      else setData({ installations, updatedAt })
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) return <p className="muted">Loading overview…</p>
  if (error) return <p className="banner banner--error">{error}</p>
  if (!data) return null

  const updated = data.updatedAt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })

  return (
    <section>
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>ONGC Offshore Overview</h3>
        </div>
        <p className="muted">Read-only · last updated {updated} IST</p>
      </div>

      <div className="ongc-grid">
        {data.installations.map((c) => (
          <button
            type="button"
            key={c.id}
            className="ongc-card"
            onClick={() => setSelected(c)}
          >
            <div className="ongc-card__head">
              <span className="ongc-card__name">{c.name}</span>
              <span className="ongc-card__type">{TYPE_LABEL[c.type] ?? c.type}</span>
            </div>
            <div className="ongc-card__pob">
              <strong>{c.personsOnBoard}</strong> aboard
            </div>
            <div className="ongc-card__health">
              <span className="ongc-chip">🟢 {c.green}</span>
              <span className="ongc-chip">🟡 {c.amber}</span>
              <span className="ongc-chip">🔴 {c.red}</span>
            </div>
            <dl className="ongc-card__money">
              <div>
                <dt>Open exposure</dt>
                <dd>{inr.format(c.openExposure)}</dd>
              </div>
              <div>
                <dt>Expected dispute</dt>
                <dd>{inr.format(c.disputeAmount)}</dd>
              </div>
            </dl>
            <span className="ongc-card__foot muted">excl. active overstays</span>
          </button>
        ))}
      </div>

      <Modal
        open={Boolean(selected)}
        title={selected ? `${selected.name} · ${TYPE_LABEL[selected.type] ?? selected.type}` : ''}
        onClose={() => setSelected(null)}
        footer={
          <button type="button" className="btn btn--primary" onClick={() => setSelected(null)}>
            Close
          </button>
        }
      >
        {selected &&
          (selected.employees.length === 0 ? (
            <p className="muted empty-state">No one currently aboard.</p>
          ) : (
            <ul className="card-list">
              {selected.employees.map((e, i) => {
                const pill = e.manifestStatus ? MANIFEST_PILL[e.manifestStatus] : null
                return (
                  <li key={i}>
                    <div className="roster-card roster-card--col">
                      <div className="roster-card__row">
                        <div className="emp-card__main">
                          <span className="emp-card__name">{e.name}</span>
                        </div>
                        <div className="roster-card__side">
                          {pill ? (
                            <span className={`pill ${pill.cls}`}>{pill.label}</span>
                          ) : (
                            <span className="pill pill--muted">On track</span>
                          )}
                          <span className="roster-card__days">
                            <strong>{e.days}</strong>d
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ))}
      </Modal>
    </section>
  )
}
