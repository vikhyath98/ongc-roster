import { useEffect, useState } from 'react'
import { listInstallations } from '../lib/reference'
import {
  getReconciliationCount,
  downloadReconciliationXlsx,
  getDobMismatchData,
  downloadDobMismatchXlsx,
} from '../lib/reports'
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

  // Accordion: only one report card expanded at a time (null = both collapsed).
  const [openCard, setOpenCard] = useState(null)
  const toggleCard = (key) => setOpenCard((c) => (c === key ? null : key))

  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  // DOB Mismatch Report
  const [dobCount, setDobCount] = useState(null)
  const [dobDownloading, setDobDownloading] = useState(false)
  const [dobError, setDobError] = useState('')
  const [dobFlash, setDobFlash] = useState('')

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
    getDobMismatchData().then((res) => {
      if (res.error) setDobError(res.error.message)
      else setDobCount(res.rows.length)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function downloadDob() {
    setDobDownloading(true)
    setDobError('')
    setDobFlash('')
    const res = await downloadDobMismatchXlsx()
    setDobDownloading(false)
    if (res.error) {
      setDobError(res.error.message)
      return
    }
    setDobFlash(`Downloaded ${res.count} employee${res.count === 1 ? '' : 's'}.`)
  }

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
        <button
          type="button"
          className="dash-card__head accordion-head"
          onClick={() => toggleCard('recon')}
          aria-expanded={openCard === 'recon'}
        >
          <h3>Reconciliation Report</h3>
          <span className="accordion-chevron">{openCard === 'recon' ? '▾' : '▸'}</span>
        </button>
        <p className="muted">
          One row per signed-off overstay stint — attribution split, ONGC/SKFS penalties, RFM
          trail and a plain-language narrative. For periodic ONGC submission.
        </p>

        {openCard === 'recon' && (
        <>
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
        </>
        )}
      </div>

      <div className="dash-card">
        <button
          type="button"
          className="dash-card__head accordion-head"
          onClick={() => toggleCard('dob')}
          aria-expanded={openCard === 'dob'}
        >
          <h3>DOB Mismatch Report</h3>
          <span className="accordion-chevron">{openCard === 'dob' ? '▾' : '▸'}</span>
        </button>
        <p className="muted">
          Employees whose date of birth differs across their Aadhaar, PAN and Passport records —
          a data-quality check (includes inactive staff).
        </p>

        {openCard === 'dob' && (
        <>
        {dobError && <p className="banner banner--error">{dobError}</p>}
        {dobCount === 0 ? (
          <p className="readiness-health readiness-health--ok">No DOB mismatches detected</p>
        ) : (
          <div className="reports-actions">
            <span className="muted">
              {dobCount == null
                ? 'Checking…'
                : `${dobCount} employee${dobCount === 1 ? '' : 's'} with a mismatch`}
            </span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={downloadDob}
              disabled={dobDownloading || !dobCount}
            >
              {dobDownloading ? 'Preparing…' : 'Download .xlsx'}
            </button>
          </div>
        )}
        {dobFlash && <p className="banner banner--info">{dobFlash}</p>}
        </>
        )}
      </div>
    </section>
  )
}
