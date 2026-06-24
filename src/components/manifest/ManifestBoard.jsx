import { useEffect, useMemo, useState } from 'react'
import { loadPipelineData, classifyBaseEmployee } from '../../lib/manifestPipeline'
import { loadCandidates } from '../../lib/reserve'
import { listEmployees } from '../../lib/employees'
import { listInstallations, listDesignations } from '../../lib/reference'
import { listInstallationRequirements } from '../../lib/configAdmin'
import { daysInclusive } from '../../lib/dates'
import { NewRequestModal } from './ManifestRequests'

// Flow B status board (SPEC.md §17.K, base-side rework). Cards are the INCOMING
// (relief) employees — the base manager's mental model — with the offshore
// employee they replace shown as context. Columns track each relief's progress.
const COLUMNS = [
  { key: 'to_manifest', label: 'To manifest', batch: 'new' },
  { key: 'filed', label: 'Filed / RFM', batch: null },
  { key: 'boarded', label: 'Boarded', batch: null },
  { key: 'retry', label: 'Retry needed', batch: 'retry' },
]

const EMPTY_MSG = {
  to_manifest: 'No confirmed base staff waiting to be manifested.',
  filed: 'Nothing currently filed / on an RFM.',
  boarded: 'No reliefs boarded this cycle.',
  retry: 'No failed reliefs to re-manifest. 👍',
}

const LOCATION_LABEL = { guesthouse: '🏨 Guesthouse', hometown: '🏠 Out of town' }

export default function ManifestBoard({ userId }) {
  const [stints, setStints] = useState([])
  const [manifestItems, setManifestItems] = useState([])
  const [pairings, setPairings] = useState([])
  const [candidates, setCandidates] = useState([])
  const [employees, setEmployees] = useState([])
  const [installations, setInstallations] = useState([])
  const [requirements, setRequirements] = useState([])
  const [designations, setDesignations] = useState([])
  const [thresholds, setThresholds] = useState({ min: 56, warning: 65, max: 70 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [activeCol, setActiveCol] = useState('to_manifest')
  const [selected, setSelected] = useState(new Set())
  const [modalSeed, setModalSeed] = useState(null) // array of base employees, or null
  const [modalMode, setModalMode] = useState('new')

  async function load() {
    setLoading(true)
    const [pipe, candRes, empRes, instRes, reqRes, desRes] = await Promise.all([
      loadPipelineData(),
      loadCandidates(),
      listEmployees(),
      listInstallations({ activeOnly: true }),
      listInstallationRequirements(),
      listDesignations(),
    ])
    if (pipe.error || candRes.error || empRes.error) {
      setError((pipe.error || candRes.error || empRes.error).message)
      setLoading(false)
      return
    }
    setStints(pipe.stints)
    setManifestItems(pipe.manifestItems)
    setPairings(pipe.pairings)
    setCandidates(candRes.candidates ?? [])
    setEmployees(empRes.data ?? [])
    if (candRes.thresholds) setThresholds(candRes.thresholds)
    if (!instRes.error) setInstallations(instRes.data ?? [])
    if (!reqRes.error) setRequirements(reqRes.data ?? [])
    if (!desRes.error) setDesignations(desRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const employeesById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const stintByEmp = useMemo(() => new Map(stints.map((s) => [s.employee?.id, s])), [stints])

  // Classify every relevant base employee: all on-base candidates (for the
  // To-manifest gate) plus anyone who is the incoming side of a pairing (they may
  // already be offshore, e.g. boarded — so they aren't in the candidates list).
  const grouped = useMemo(() => {
    const byId = new Map()
    for (const c of candidates) byId.set(c.id, c)
    for (const p of pairings) {
      const id = p.incoming_employee_id
      if (id && !byId.has(id) && employeesById.has(id)) byId.set(id, employeesById.get(id))
    }
    const g = { to_manifest: [], filed: [], boarded: [], retry: [] }
    for (const emp of byId.values()) {
      const r = classifyBaseEmployee(emp, { pairings, manifestItems })
      if (r && g[r.column]) g[r.column].push({ emp, pairing: r.pairing ?? null })
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (a.emp.full_name ?? '').localeCompare(b.emp.full_name ?? ''))
    }
    return g
  }, [candidates, pairings, manifestItems, employeesById])

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

  // The offshore employee a relief is replacing (name + installation + days).
  function outgoingContext(pairing) {
    const outId = pairing?.outgoing_employee_id
    if (!outId) return 'Not yet paired'
    const name = employeesById.get(outId)?.full_name ?? '—'
    const st = stintByEmp.get(outId)
    return st
      ? `Replacing → ${name}, ${st.installation?.name ?? '—'} · ${daysInclusive(st.sign_on_date)}d`
      : `Replacing → ${name}`
  }
  function statusDetail(column, pairing) {
    const sortie = pairing?.rfm_line_item?.rfm?.sortie_date
    switch (column) {
      case 'to_manifest':
        return 'Confirmed — ready to send'
      case 'filed':
        return pairing?.status === 'rfm_listed'
          ? `On RFM${sortie ? ` · sortie ${sortie}` : ''}`
          : 'Filed — awaiting RFM'
      case 'boarded':
        return `Boarded${sortie ? ` · sortie ${sortie}` : ''}`
      case 'retry':
        return `Last attempt ${pairing?.status === 'no_show' ? 'no-showed' : 'dropped'} — re-manifest`
      default:
        return ''
    }
  }

  const colDef = COLUMNS.find((c) => c.key === activeCol)
  const rows = grouped[activeCol] ?? []
  const selectedRows = rows.filter((r) => selected.has(r.emp.id))

  function openBatch() {
    if (selectedRows.length === 0) return
    const isRetry = colDef.batch === 'retry'
    // For a retry, lock each relief to the outgoing employee recorded on its
    // failed pairing so the manager doesn't pick them again.
    const seed = selectedRows.map((r) =>
      isRetry ? { ...r.emp, lockedOutgoingId: r.pairing?.outgoing_employee_id ?? null } : r.emp
    )
    setModalMode(isRetry ? 'retry' : 'new')
    setModalSeed(seed)
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
          {rows.map(({ emp, pairing }) => {
            const selectable = Boolean(colDef.batch)
            const isSel = selected.has(emp.id)
            const loc = LOCATION_LABEL[emp.base_location_type]
            return (
              <li key={emp.id}>
                <div
                  className={
                    'board-card' +
                    (selectable ? ' board-card--selectable' : '') +
                    (isSel ? ' is-selected' : '')
                  }
                  onClick={selectable ? () => toggleSelect(emp.id) : undefined}
                  role={selectable ? 'button' : undefined}
                  aria-pressed={selectable ? isSel : undefined}
                >
                  {selectable && (
                    <input
                      type="checkbox"
                      className="board-card__check"
                      checked={isSel}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  )}
                  <div className="board-card__body">
                    <span className="emp-card__name">{emp.full_name}</span>
                    <span className="emp-card__meta">
                      {emp.emp_id} · {emp.designation?.name ?? '—'}
                    </span>
                    {loc && <span className="reserve-sub">{loc}</span>}
                    <span className="reserve-sub">{outgoingContext(pairing)}</span>
                    <span className="reserve-sub">{statusDetail(activeCol, pairing)}</span>
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
            <button type="button" className="btn btn--primary" onClick={openBatch}>
              {colDef.batch === 'retry'
                ? `Create retry request for ${selected.size}`
                : `Create manifest request for ${selected.size} employee${selected.size === 1 ? '' : 's'}`}
            </button>
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
        seedIncoming={modalSeed ?? []}
        mode={modalMode}
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
