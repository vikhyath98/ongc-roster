import { useEffect, useState } from 'react'
import Modal from './Modal'
import { getEvidenceForStint, ATTR_LABEL } from '../lib/reports'

// Single-case, in-app evidence view for one overstay stint (SPEC.md §14.8):
// the attribution split, the full manifest/RFM retry trail, and reconciliation
// status. Same underlying data as the Reconciliation Report's row.
export default function EvidenceModal({ open, rotationLogId, employeeName, installation, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !rotationLogId) return
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    getEvidenceForStint(rotationLogId).then((res) => {
      if (!active) return
      if (res.error) setError(res.error.message)
      else setData(res)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [open, rotationLogId])

  const a = data?.attribution

  return (
    <Modal
      open={open}
      title={`Evidence — ${employeeName ?? ''}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      {installation && <p className="muted">📍 {installation}</p>}
      {loading && <p className="muted">Loading evidence…</p>}
      {error && <p className="banner banner--error">{error}</p>}

      {data && (
        <>
          <h3 className="section-heading">Attribution</h3>
          {a ? (
            <ul className="evidence-segs">
              <li>
                <strong>Segment 1</strong> — {a.seg1Days}d ·{' '}
                <strong>{ATTR_LABEL[a.seg1Attr] ?? '—'}</strong>
                {a.seg1Overridden && ' (overridden)'}
                {a.seg1Overridden && a.seg1Remark ? ` — “${a.seg1Remark}”` : ''}
              </li>
              {a.seg2Days > 0 && (
                <li>
                  <strong>Segment 2</strong> — {a.seg2Days}d ·{' '}
                  <strong>{ATTR_LABEL[a.seg2Attr] ?? '—'}</strong>
                  {a.seg2Overridden && ' (overridden)'}
                  {a.seg2Overridden && a.seg2Remark ? ` — “${a.seg2Remark}”` : ''}
                </li>
              )}
            </ul>
          ) : (
            <p className="muted">No attribution recorded.</p>
          )}

          <h3 className="section-heading">Manifest / RFM trail</h3>
          <p>{data.narrative}</p>

          <h3 className="section-heading">Reconciliation</h3>
          {data.reconciliation.reconciled ? (
            <p>
              <span className="pill pill--ok">Reconciled</span>{' '}
              {data.reconciliation.reconciledAt?.slice(0, 10)}
              {data.reconciliation.remark ? ` — “${data.reconciliation.remark}”` : ''}
            </p>
          ) : (
            <p>
              <span className="pill pill--muted">Unreconciled</span>
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
