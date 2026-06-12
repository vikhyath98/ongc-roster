import Modal from './Modal'
import { isDeprioritised } from '../lib/reserve'
import { daysInclusive } from '../lib/dates'

const OUTCOME_LABEL = {
  no_answer: 'No answer',
  call_back: 'Call back',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

function callSummary(av) {
  const n = av?.call_count ?? 0
  const base = `📞 ${n} call${n === 1 ? '' : 's'}`
  if (!av?.last_call_outcome) return `${base} · not called`
  const when = av.last_call_at ? ` (${av.last_call_at.slice(0, 10)})` : ''
  return `${base} · last: ${OUTCOME_LABEL[av.last_call_outcome] ?? av.last_call_outcome}${when}`
}

const restLabel = (c) => (c.restDays === null ? 'No prior offshore' : `${c.restDays}d rest`)

// Bottom sheet launched from an Offshore roster card. Replaces the old
// standalone Replacement Finder: pick is the target, the body shows who is
// confirmed-ready, who can be called, and who is blocked — all for the
// target's designation. Call/Confirm actions are handled by the parent.
export default function ReplaceSheet({
  open,
  target,
  targetState,
  groups,
  flash,
  error,
  onCall,
  onConfirm,
  onClose,
}) {
  if (!open || !target) return null

  const days = daysInclusive(target.sign_on_date)
  const deadline = target.expected_rotation_date
  const { confirmed = [], available = [], blocked = [] } = groups ?? {}
  const designationName = target.employee?.designation?.name ?? ''

  return (
    <Modal open={open} title="Find replacement" onClose={onClose}>
      <div className={`target-card ${targetState?.cls ?? ''}`}>
        <div className="target-card__top">
          <div>
            <span className="emp-card__name">{target.employee?.full_name}</span>
            <span className="emp-card__meta">
              {target.employee?.emp_id} · {designationName} · 📍 {target.installation?.name}
            </span>
          </div>
          {targetState?.label && <span className={`pill ${targetState.cls}`}>{targetState.label}</span>}
        </div>
        <div className="target-card__stats">
          <span>
            <strong>{days}</strong> days served
          </span>
          {deadline && (
            <span>
              Rotation deadline: <strong>{deadline}</strong>
            </span>
          )}
        </div>
      </div>

      {flash && <p className="banner banner--info">{flash}</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {/* Confirmed ready */}
      {confirmed.length > 0 && (
        <>
          <h3 className="section-heading">✅ Confirmed ready ({confirmed.length})</h3>
          <ul className="card-list">
            {confirmed.map((c) => {
              const exp = c.availability?.expires_at?.slice(0, 10)
              return (
                <li key={c.id}>
                  <div className="cand-card">
                    <div className="cand-card__head">
                      <div className="emp-card__main">
                        <span className="emp-card__name">{c.full_name}</span>
                        <span className="emp-card__meta">
                          {c.emp_id} · {restLabel(c)}
                        </span>
                      </div>
                      <span className="pill pill--ok">Confirmed</span>
                    </div>
                    <div className="cand-card__calls muted">
                      {callSummary(c.availability)}
                      {exp ? ` · valid until ${exp}` : ''}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* Available to call */}
      <h3 className="section-heading">📞 Available to call ({available.length})</h3>
      {available.length === 0 ? (
        <p className="muted empty-state">
          No eligible, cert-current {designationName} on base to call.
        </p>
      ) : (
        <ul className="card-list">
          {available.map((c) => {
            const dim = isDeprioritised(c)
            return (
              <li key={c.id}>
                <div className={'cand-card' + (dim ? ' cand-card--dim' : '')}>
                  <div className="cand-card__head">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{c.full_name}</span>
                      <span className="emp-card__meta">
                        {c.emp_id} · {restLabel(c)}
                      </span>
                    </div>
                    <span className="pill pill--ok">Certs OK</span>
                  </div>
                  <div className="cand-card__calls muted">
                    {callSummary(c.availability)}
                    {dim && ' · repeated no-answer'}
                  </div>
                  <div className="cand-card__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onCall(c)}
                    >
                      Call…
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => onConfirm(c)}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Blocked */}
      {blocked.length > 0 && (
        <>
          <h3 className="section-heading">🚫 Not available ({blocked.length})</h3>
          <ul className="card-list">
            {blocked.map((c) => (
              <li key={c.id}>
                <div className="cand-card cand-card--dim">
                  <div className="cand-card__head">
                    <div className="emp-card__main">
                      <span className="emp-card__name">{c.full_name}</span>
                      <span className="emp-card__meta">
                        {c.emp_id} · {restLabel(c)}
                      </span>
                    </div>
                    <span className="pill pill--bad">{c.status?.label}</span>
                  </div>
                  <div className="cand-card__calls muted">{c.status?.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
