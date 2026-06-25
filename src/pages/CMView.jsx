import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  loadReturnTasks,
  fileReturnManifest,
  submitReason,
} from '../lib/returnManifest'

// Catering-manager landing (SPEC.md §17.M / §17.N): the return-manifest task
// list, scoped to the CM's installation(s). Each boarded relief strands an
// outgoing employee until the ONGC return manifest is filed; the CM files it
// (return RFM number + sortie date) or, once overdue, submits a reason.

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '—'

const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      }) + ' IST'
    : '—'

const daysSince = (iso) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0

const STATUS_PILL = {
  pending: { cls: 'pill--warn', label: 'Pending' },
  filed: { cls: 'pill--ok', label: 'Filed' },
  submitted: { cls: 'pill--muted', label: 'Reason submitted' },
}

export default function CMView() {
  const { profile, user } = useAuth()
  const installations = profile?.installations ?? []
  const who = profile?.full_name || user?.email || 'Catering manager'

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [completedOpen, setCompletedOpen] = useState(false)

  // Inline action form state: { id, mode: 'file' | 'reason' } + fields.
  const [active, setActive] = useState(null)
  const [rfmNumber, setRfmNumber] = useState('')
  const [sortieDate, setSortieDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const installationIds = useMemo(() => installations.map((i) => i.id), [installations])

  async function load() {
    setLoading(true)
    const { data, error: e } = await loadReturnTasks(installationIds)
    if (e) setError(e.message)
    else setTasks(data)
    setLoading(false)
  }

  useEffect(() => {
    // Wait until the profile's installations have loaded before querying.
    if (profile) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, installationIds.join(',')])

  const { overdue, upcoming, completed } = useMemo(() => {
    const now = Date.now()
    const overdue = []
    const upcoming = []
    const completed = []
    for (const t of tasks) {
      if (t.status !== 'pending') completed.push(t)
      else if (new Date(t.deadline).getTime() < now) overdue.push(t)
      else upcoming.push(t)
    }
    return { overdue, upcoming, completed }
  }, [tasks])

  function openForm(taskId, mode) {
    setActive({ id: taskId, mode })
    setRfmNumber('')
    setSortieDate('')
    setReason('')
    setError('')
  }

  async function onFile(taskId) {
    if (!rfmNumber.trim() || !sortieDate) return
    setBusy(true)
    setError('')
    const { error: e } = await fileReturnManifest(taskId, {
      returnRfmNumber: rfmNumber,
      returnSortieDate: sortieDate,
      userId: profile?.id,
    })
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    setActive(null)
    load()
  }

  async function onSubmitReason(taskId) {
    if (!reason.trim()) return
    setBusy(true)
    setError('')
    const { error: e } = await submitReason(taskId, { reason, userId: profile?.id })
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    setActive(null)
    load()
  }

  // One task card. `isOverdue` toggles the "Submit reason" affordance, which is
  // only offered once the deadline has passed (SPEC.md §17.N).
  const renderCard = (t, { isOverdue = false } = {}) => {
    const pill = STATUS_PILL[t.status] ?? STATUS_PILL.pending
    const formOpen = active?.id === t.id
    return (
      <div className={`roster-card roster-card--col${isOverdue ? ' state--red' : ''}`}>
        <div className="roster-card__row">
          <div className="emp-card__main">
            <span className="emp-card__name">{t.outgoing?.full_name ?? '—'}</span>
            <span className="emp-card__meta">
              {t.outgoing?.emp_id ?? '—'} · {t.outgoing?.designation?.name ?? '—'}
            </span>
            <span className="emp-card__meta">📍 {t.installation?.name ?? '—'}</span>
            <span className="reserve-sub">
              Boarded: {fmtDate(t.created_at)} · Deadline: {fmtDateTime(t.deadline)}
            </span>
          </div>
          <div className="roster-card__side">
            <span className={`pill ${pill.cls}`}>{pill.label}</span>
            <span className="roster-card__days">
              <strong>{daysSince(t.created_at)}</strong>d since boarded
            </span>
          </div>
        </div>

        {/* Completed cards show what was recorded. */}
        {t.status === 'filed' && (
          <span className="reserve-sub">
            Return RFM {t.return_rfm_number ?? '—'} · sortie {fmtDate(t.return_sortie_date)}
          </span>
        )}
        {t.status === 'submitted' && (
          <span className="reserve-sub">Reason: {t.reason ?? '—'}</span>
        )}

        {/* Pending cards: actions. */}
        {t.status === 'pending' && !formOpen && (
          <div className="roster-card__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => openForm(t.id, 'file')}
            >
              File return manifest
            </button>
            {isOverdue && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => openForm(t.id, 'reason')}
              >
                Submit reason
              </button>
            )}
          </div>
        )}

        {/* Inline: File return manifest. */}
        {formOpen && active.mode === 'file' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onFile(t.id)
            }}
          >
            <label className="field">
              <span>Return RFM number</span>
              <input
                type="text"
                value={rfmNumber}
                onChange={(e) => setRfmNumber(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>Return sortie date</span>
              <input
                type="date"
                value={sortieDate}
                onChange={(e) => setSortieDate(e.target.value)}
                required
              />
            </label>
            <div className="roster-card__actions">
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={busy || !rfmNumber.trim() || !sortieDate}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setActive(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Inline: Submit reason. */}
        {formOpen && active.mode === 'reason' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmitReason(t.id)
            }}
          >
            <label className="field">
              <span>Reason</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                required
                autoFocus
              />
            </label>
            <div className="roster-card__actions">
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={busy || !reason.trim()}
              >
                {busy ? 'Saving…' : 'Submit'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setActive(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  return (
    <section>
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Return manifests</h3>
        </div>
        <p className="muted">
          Signed in as <strong>{who}</strong>
          {' · '}
          {installations.length > 0 ? (
            installations.map((i) => `📍 ${i.name}`).join('  ·  ')
          ) : (
            <em>no installation assigned</em>
          )}
        </p>
      </div>

      {error && <p className="banner banner--error">{error}</p>}

      {loading ? (
        <p className="muted">Loading return manifests…</p>
      ) : overdue.length === 0 && upcoming.length === 0 && completed.length === 0 ? (
        <p className="muted empty-state">All clear — no pending return manifests.</p>
      ) : (
        <>
          {overdue.length > 0 && (
            <div className="dash-card">
              <div className="dash-card__head">
                <h3>⚠️ Overdue</h3>
                <span className="muted">{overdue.length} past deadline</span>
              </div>
              <ul className="card-list">
                {overdue.map((t) => (
                  <li key={t.id}>{renderCard(t, { isOverdue: true })}</li>
                ))}
              </ul>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="dash-card">
              <div className="dash-card__head">
                <h3>Due today / upcoming</h3>
                <span className="muted">{upcoming.length} pending</span>
              </div>
              <ul className="card-list">
                {upcoming.map((t) => (
                  <li key={t.id}>{renderCard(t)}</li>
                ))}
              </ul>
            </div>
          )}

          {completed.length > 0 && (
            <div className="dash-card">
              <button
                type="button"
                className="dash-card__head accordion-head"
                onClick={() => setCompletedOpen((o) => !o)}
                aria-expanded={completedOpen}
              >
                <h3>Completed</h3>
                <span className="muted">{completed.length} done</span>
                <span className="accordion-chevron">{completedOpen ? '▾' : '▸'}</span>
              </button>
              {completedOpen && (
                <ul className="card-list">
                  {completed.map((t) => (
                    <li key={t.id}>{renderCard(t)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
