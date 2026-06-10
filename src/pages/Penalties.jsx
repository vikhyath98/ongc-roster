import { useEffect, useMemo, useState } from 'react'
import {
  listPenaltyExposure,
  listReconciledPenalties,
  reconcilePenalty,
} from '../lib/penalties'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})
const money = (n) => inr.format(Number(n || 0))

export default function Penalties() {
  const { user } = useAuth()
  const [tab, setTab] = useState('unreconciled')
  const [exposure, setExposure] = useState([])
  const [reconciled, setReconciled] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reconcileFor, setReconcileFor] = useState(null)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const [expRes, recRes] = await Promise.all([listPenaltyExposure(), listReconciledPenalties()])
    if (expRes.error) setError(expRes.error.message)
    else setExposure(expRes.data ?? [])
    if (!recRes.error) setReconciled(recRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Live exposure rows that have not been reconciled yet.
  const reconciledStintIds = useMemo(
    () => new Set(reconciled.map((r) => r.rotation_log_id)),
    [reconciled]
  )
  const unreconciled = useMemo(
    () => exposure.filter((e) => !reconciledStintIds.has(e.rotation_log_id)),
    [exposure, reconciledStintIds]
  )
  const openTotal = useMemo(
    () => unreconciled.reduce((sum, e) => sum + Number(e.total_penalty || 0), 0),
    [unreconciled]
  )

  function openReconcile(row) {
    setReconcileFor(row)
    setRemark('')
    setError('')
  }

  async function confirmReconcile() {
    setBusy(true)
    setError('')
    const { error: err } = await reconcilePenalty(reconcileFor, remark, user?.id)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setReconcileFor(null)
    load()
  }

  return (
    <section>
      <div className="seg">
        <button
          type="button"
          className={'seg__btn' + (tab === 'unreconciled' ? ' seg__btn--on' : '')}
          onClick={() => setTab('unreconciled')}
        >
          Unreconciled
        </button>
        <button
          type="button"
          className={'seg__btn' + (tab === 'reconciled' ? ' seg__btn--on' : '')}
          onClick={() => setTab('reconciled')}
        >
          Reconciled
        </button>
      </div>

      {loading && <p className="muted">Loading penalties…</p>}
      {error && !reconcileFor && <p className="banner banner--error">{error}</p>}

      {!loading && tab === 'unreconciled' && (
        <>
          <div className="penalty-total">
            <span className="penalty-total__label">Open exposure</span>
            <span className="penalty-total__value">{money(openTotal)}</span>
            <span className="muted">
              {unreconciled.length} stint{unreconciled.length === 1 ? '' : 's'} over threshold
            </span>
          </div>

          {unreconciled.length === 0 ? (
            <p className="muted empty-state">No active penalties. Nobody is past the hard threshold.</p>
          ) : (
            <ul className="card-list">
              {unreconciled.map((p) => (
                <li key={p.rotation_log_id}>
                  <div className="roster-card state--red">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{p.full_name}</span>
                      <span className="emp-card__meta">
                        {p.emp_id} · {p.designation_name} · 📍 {p.installation_name}
                      </span>
                      <span className="reserve-sub">
                        {p.days_served}d served · {p.days_over}d over · {money(p.daily_penalty_rate)}/day
                        {p.finalised ? ' · signed off (final)' : ' · still offshore (growing)'}
                      </span>
                    </div>
                    <div className="penalty-card__side">
                      <span className="penalty-amount">{money(p.total_penalty)}</span>
                      {p.finalised ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => openReconcile(p)}
                        >
                          Reconcile
                        </button>
                      ) : (
                        <span className="penalty-blocked">Still offshore — offboard first</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!loading && tab === 'reconciled' && (
        <>
          <p className="list-count muted">
            {reconciled.length} reconciled · {money(reconciled.reduce((s, r) => s + Number(r.total_penalty || 0), 0))} total
          </p>
          {reconciled.length === 0 ? (
            <p className="muted empty-state">Nothing reconciled yet.</p>
          ) : (
            <ul className="card-list">
              {reconciled.map((r) => (
                <li key={r.id}>
                  <div className="roster-card state--green">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{r.employee?.full_name ?? '—'}</span>
                      <span className="emp-card__meta">
                        {r.employee?.emp_id} · {r.employee?.designation?.name ?? ''} · 📍{' '}
                        {r.installation?.name ?? ''}
                      </span>
                      <span className="reserve-sub">
                        {r.days_over}d over · reconciled {r.reconciled_at?.slice(0, 10)}
                      </span>
                      <span className="penalty-remark">“{r.reconciliation_remark}”</span>
                    </div>
                    <div className="penalty-card__side">
                      <span className="penalty-amount penalty-amount--done">{money(r.total_penalty)}</span>
                      <span className="pill pill--ok">Reconciled</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        open={Boolean(reconcileFor)}
        title="Reconcile penalty"
        onClose={() => setReconcileFor(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setReconcileFor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !remark.trim()}
              onClick={confirmReconcile}
            >
              {busy ? 'Saving…' : 'Reconcile'}
            </button>
          </>
        }
      >
        {reconcileFor && (
          <>
            <p>
              Reconcile <strong>{reconcileFor.full_name}</strong>’s penalty of{' '}
              <strong>{money(reconcileFor.total_penalty)}</strong> ({reconcileFor.days_over}d over) at{' '}
              {reconcileFor.installation_name}.
            </p>
            <p className="muted">
              This moves it out of active exposure into history. It is never deleted. A remark
              stating it has been reconciled with ONGC is required.
            </p>
            <label className="field">
              <span>Reconciliation remark *</span>
              <textarea
                rows={3}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="e.g. Reconciled with ONGC — transport was not arranged for this rotation."
              />
            </label>
            {error && <p className="banner banner--error">{error}</p>}
          </>
        )}
      </Modal>
    </section>
  )
}
