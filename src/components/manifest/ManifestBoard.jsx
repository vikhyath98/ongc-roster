import { useEffect, useMemo, useState } from 'react'
import { loadPipelineData, classifyOffshoreEmployee } from '../../lib/manifestPipeline'
import { loadCandidates } from '../../lib/reserve'
import { listInstallations, listDesignations } from '../../lib/reference'
import { listInstallationRequirements } from '../../lib/configAdmin'
import { daysInclusive } from '../../lib/dates'
import { NewRequestModal } from './ManifestRequests'

// Flow B status board (SPEC.md §17.K): currently-offshore employees bucketed into
// the four relief-pipeline columns via the shared classifier. Needs-manifest and
// Retry-needed support batch selection → create a (retry) manifest request.
const COLUMNS = [
  { key: 'needs_manifest', label: 'Needs manifest', batch: 'new' },
  { key: 'filed', label: 'Filed / RFM', batch: null },
  { key: 'retry', label: 'Retry needed', batch: 'retry' },
  { key: 'boarded', label: 'Boarded', batch: null },
]

const EMPTY_MSG = {
  needs_manifest: 'All caught up — every overdue employee has a manifest filed.',
  filed: 'Nothing currently awaiting an RFM.',
  retry: 'No failed reliefs to retry. 👍',
  boarded: 'No active boardings this cycle.',
}

function statusDetail(column, pairing) {
  switch (column) {
    case 'needs_manifest':
      return 'No request filed yet'
    case 'filed':
      return pairing?.status === 'rfm_listed' ? 'Listed on an RFM' : 'Request filed — awaiting RFM'
    case 'retry':
      return `Last relief ${pairing?.status === 'no_show' ? 'no-showed' : 'was dropped'} — retry needed`
    case 'boarded':
      return 'Relief boarded'
    default:
      return ''
  }
}

export default function ManifestBoard({ userId }) {
  const [stints, setStints] = useState([])
  const [manifestItems, setManifestItems] = useState([])
  const [pairings, setPairings] = useState([])
  const [candidates, setCandidates] = useState([])
  const [installations, setInstallations] = useState([])
  const [requirements, setRequirements] = useState([])
  const [designations, setDesignations] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [activeCol, setActiveCol] = useState('needs_manifest')
  const [selected, setSelected] = useState(new Set())
  const [modalSeed, setModalSeed] = useState(null) // array of stints, or null

  async function load() {
    setLoading(true)
    const [pipe, candRes, instRes, reqRes, desRes] = await Promise.all([
      loadPipelineData(),
      loadCandidates(),
      listInstallations({ activeOnly: true }),
      listInstallationRequirements(),
      listDesignations(),
    ])
    if (pipe.error || candRes.error) {
      setError((pipe.error || candRes.error).message)
      setLoading(false)
      return
    }
    setStints(pipe.stints)
    setManifestItems(pipe.manifestItems)
    setPairings(pipe.pairings)
    setCandidates(candRes.candidates ?? [])
    if (candRes.thresholds) setThresholds(candRes.thresholds)
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (!reqRes.error) setRequirements(reqRes.data ?? [])
    if (!desRes.error) setDesignations(desRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Classify every offshore stint into its column (null = no action needed).
  const grouped = useMemo(() => {
    const g = { needs_manifest: [], filed: [], retry: [], boarded: [] }
    const args = { manifestItems, pairings, warningDay: thresholds.warning }
    for (const s of stints) {
      const r = classifyOffshoreEmployee(s, args)
      if (r && g[r.column]) g[r.column].push({ stint: s, pairing: r.pairing ?? null })
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => daysInclusive(b.stint.sign_on_date) - daysInclusive(a.stint.sign_on_date))
    }
    return g
  }, [stints, manifestItems, pairings, thresholds])

  function switchColumn(key) {
    setActiveCol(key)
    setSelected(new Set())
  }
  function toggleSelect(id) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const colDef = COLUMNS.find((c) => c.key === activeCol)
  const rows = grouped[activeCol] ?? []
  const selectedStints = rows.filter((r) => selected.has(r.stint.id)).map((r) => r.stint)
  const installationsInSelection = new Set(selectedStints.map((s) => s.installation_id))
  const multiInstall = installationsInSelection.size > 1

  function openBatch() {
    if (multiInstall || selectedStints.length === 0) return
    setModalSeed(selectedStints)
  }

  if (loading) return <p className="muted">Loading board…</p>
  if (error) return <p className="banner banner--error">{error}</p>

  return (
    <div className="board-tab">
      <div className="seg seg--sub manifest-board__cols">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={'seg__btn' + (activeCol === c.key ? ' seg__btn--on' : '')}
            onClick={() => switchColumn(c.key)}
          >
            {c.label} ({grouped[c.key].length})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="muted empty-state">{EMPTY_MSG[activeCol]}</p>
      ) : (
        <ul className="card-list">
          {rows.map(({ stint: s, pairing }) => {
            const selectable = Boolean(colDef.batch)
            const isSel = selected.has(s.id)
            return (
              <li key={s.id}>
                <div
                  className={
                    'roster-card roster-card--col' +
                    (selectable ? ' roster-card--selectable' : '') +
                    (isSel ? ' is-selected' : '')
                  }
                  onClick={selectable ? () => toggleSelect(s.id) : undefined}
                  role={selectable ? 'button' : undefined}
                  aria-pressed={selectable ? isSel : undefined}
                >
                  <div className="roster-card__row">
                    {selectable && (
                      <input
                        type="checkbox"
                        className="roster-card__check"
                        checked={isSel}
                        readOnly
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                    )}
                    <div className="emp-card__main">
                      <span className="emp-card__name">{s.employee?.full_name ?? '—'}</span>
                      <span className="emp-card__meta">
                        {s.employee?.emp_id} · {s.employee?.designation?.name ?? '—'}
                      </span>
                      <span className="reserve-sub">
                        📍 {s.installation?.name ?? '—'} · {daysInclusive(s.sign_on_date)}d served
                      </span>
                      <span className="reserve-sub">{statusDetail(activeCol, pairing)}</span>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {colDef.batch && selected.size > 0 && (
        <>
          <div className="board-actionbar-spacer" aria-hidden="true" />
          <div className="board-actionbar">
            {multiInstall ? (
              <p className="banner banner--error" style={{ margin: 0 }}>
                Selection spans multiple installations — select one at a time.
              </p>
            ) : (
              <button type="button" className="btn btn--primary" onClick={openBatch}>
                {colDef.batch === 'retry'
                  ? `Create retry request for ${selected.size}`
                  : `Create manifest request for ${selected.size} employee${selected.size === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </>
      )}

      <NewRequestModal
        open={Boolean(modalSeed)}
        userId={userId}
        installations={installations}
        candidates={candidates}
        requirements={requirements}
        designations={designations}
        offshore={stints}
        thresholds={thresholds}
        seedOutgoing={modalSeed ?? []}
        mode={colDef?.batch === 'retry' ? 'retry' : 'new'}
        onClose={() => setModalSeed(null)}
        onCreated={() => {
          setModalSeed(null)
          setSelected(new Set())
          load()
        }}
      />
    </div>
  )
}
