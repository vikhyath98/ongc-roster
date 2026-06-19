import { useEffect, useState } from 'react'
import { listInstallations } from '../lib/reference'
import { getReconciliationCount, downloadReconciliationXlsx } from '../lib/reports'
import { todayISO, addDays } from '../lib/dates'

// Reports hub (SPEC.md §14.8, Workstream E). Extensible list of report cards;
// the Reconciliation Report is the first. (DOB Mismatch Report is deferred to
// Workstream H, when DOB capture exists.)
export default function Reports() {
  const [installations, setInstallations] = useState([])
  const [installationId, setInstallationId] = useState('')
  const [dateFrom, setDateFrom] = useState(addDays(todayISO(), -90))
  const [dateTo, setDateTo] = useState(todayISO())
  const [status, setStatus] = useState('all')

  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  const filters = () => ({
    installationId: installationId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status,
  })

  // Preview count only — runs on mount and on "Apply", never per keystroke.
  async function refreshCount() {
    setCounting(true)
    setError('')
    setFlash('')
    const res = await getReconciliationCount(filters())
    setCounting(false)
    if (res.error) {
      setError(res.error.message)
      setCount(null)
      return
    }
    setCount(res.count)
  }

  useEffect(() => {
    listInstallations().then((r) => {
      if (!r.error) setInstallations(r.data ?? [])
    })
    refreshCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function download() {
    setDownloading(true)
    setError('')
    setFlash('')
    const res = await downloadReconciliationXlsx(filters())
    setDownloading(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    setFlash(
      res.count === 0
        ? 'No stints match these filters — nothing to download.'
        : `Downloaded ${res.count} stint${res.count === 1 ? '' : 's'}.`
    )
  }

  return (
    <section>
      <div className="dash-card__head">
        <h3>Reports</h3>
      </div>

      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Reconciliation Report</h3>
        </div>
        <p className="muted">
          One row per signed-off overstay stint — attribution split, ONGC/SKFS penalties, RFM
          trail and a plain-language narrative. For periodic ONGC submission.
        </p>

        <div className="board-controls roster-filters">
          <label className="field">
            <span>From (sign-off)</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>To (sign-off)</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label className="field">
            <span>Installation</span>
            <select value={installationId} onChange={(e) => setInstallationId(e.target.value)}>
              <option value="">All installations</option>
              {installations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="unreconciled">Unreconciled</option>
              <option value="reconciled">Reconciled</option>
            </select>
          </label>
        </div>

        <div className="reports-actions">
          <button type="button" className="btn btn--ghost" onClick={refreshCount} disabled={counting}>
            {counting ? 'Checking…' : 'Apply filters'}
          </button>
          <span className="muted">
            {count == null ? '' : `${count} stint${count === 1 ? '' : 's'} match`}
          </span>
          <button
            type="button"
            className="btn btn--primary"
            onClick={download}
            disabled={downloading}
          >
            {downloading ? 'Preparing…' : 'Download .xlsx'}
          </button>
        </div>

        {error && <p className="banner banner--error">{error}</p>}
        {flash && <p className="banner banner--info">{flash}</p>}
      </div>
    </section>
  )
}
