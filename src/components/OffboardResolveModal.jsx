import { useEffect, useState } from 'react'
import Modal from './Modal'

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

// Shown before completing an offboard that is an understay (< min) or an
// overstay (> max). The parent drives it sequentially per employee.
export default function OffboardResolveModal({
  resolve,
  cfg,
  busy,
  onUnderstayConfirm,
  onOverstayConfirm,
  onCancel,
}) {
  const kind = resolve?.kind
  const [reason, setReason] = useState('')
  const [s1, setS1] = useState({ attr: 'skfs', remark: '' })
  const [s2, setS2] = useState({ attr: 'ongc', remark: '' })

  useEffect(() => {
    if (!resolve) return
    if (kind === 'understay') setReason(resolve.prefillReason || '')
    if (kind === 'overstay') {
      setS1({ attr: resolve.over.seg1Default ?? 'skfs', remark: '' })
      setS2({ attr: resolve.over.seg2Default ?? 'ongc', remark: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve])

  if (!resolve) return null
  const who = resolve.stint.employee?.full_name ?? '—'

  if (kind === 'understay') {
    const short = Math.max(0, cfg.min - resolve.daysServed)
    const total = cfg.understayFixed + cfg.understayDaily * short
    return (
      <Modal
        open
        title={`Early sign-off — ${who}`}
        onClose={onCancel}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !reason.trim()}
              onClick={() => onUnderstayConfirm(reason)}
            >
              {busy ? 'Saving…' : 'Confirm sign-off'}
            </button>
          </>
        }
      >
        <p>
          This employee served only <strong>{resolve.daysServed}</strong> days (under the {cfg.min}
          -day minimum).
        </p>
        <label className="field">
          <span>Reason for early sign-off *</span>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p className="banner banner--warn">
          Understay cost (placeholder rates): {inr.format(cfg.understayFixed)} fixed +{' '}
          {inr.format(cfg.understayDaily)}/day × {short} = <strong>{inr.format(total)}</strong>.
          Rates are not yet confirmed in Configuration.
        </p>
      </Modal>
    )
  }

  // Overstay
  const over = resolve.over
  const s1Changed = s1.attr !== (over.seg1Default ?? 'skfs')
  const hasSeg2 = over.seg2Days > 0
  const s2Changed = hasSeg2 && s2.attr !== (over.seg2Default ?? 'ongc')
  const canConfirm =
    !busy && (!s1Changed || s1.remark.trim()) && (!s2Changed || s2.remark.trim())

  return (
    <Modal
      open
      title={`Overstay attribution — ${who}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canConfirm}
            onClick={() =>
              onOverstayConfirm({
                seg1Attr: s1.attr,
                seg1Remark: s1.remark,
                seg2Attr: s2.attr,
                seg2Remark: s2.remark,
              })
            }
          >
            {busy ? 'Saving…' : 'Confirm sign-off'}
          </button>
        </>
      }
    >
      <p>
        This employee served <strong>{resolve.daysServed}</strong> days — over the {cfg.max}-day
        threshold. Attribute the overstay:
      </p>

      <SegmentEditor
        label="Segment 1 — wait for relief"
        days={over.seg1Days}
        value={s1}
        setValue={setS1}
        defaultAttr={over.seg1Default}
      />
      {hasSeg2 && (
        <SegmentEditor
          label="Segment 2 — after relief arrived"
          days={over.seg2Days}
          value={s2}
          setValue={setS2}
          defaultAttr={over.seg2Default}
        />
      )}

      <p className="field-hint muted">
        Attribution is additive — it does not change the penalty amount itself.
      </p>
    </Modal>
  )
}

function SegmentEditor({ label, days, value, setValue, defaultAttr }) {
  const changed = value.attr !== defaultAttr
  return (
    <div className="seg-editor">
      <div className="dash-card__head">
        <h3>{label}</h3>
        <span className="muted">{days}d</span>
      </div>
      <div className="seg">
        <button
          type="button"
          className={'seg__btn' + (value.attr === 'ongc' ? ' seg__btn--on' : '')}
          onClick={() => setValue((v) => ({ ...v, attr: 'ongc' }))}
        >
          ONGC
        </button>
        <button
          type="button"
          className={'seg__btn' + (value.attr === 'skfs' ? ' seg__btn--on' : '')}
          onClick={() => setValue((v) => ({ ...v, attr: 'skfs' }))}
        >
          SKFS
        </button>
      </div>
      <p className="field-hint muted">
        Default: {(defaultAttr ?? '—').toUpperCase()}
        {changed ? ' · changed from default' : ''}
      </p>
      {changed && (
        <label className="field">
          <span>Remark for change *</span>
          <textarea
            rows={2}
            value={value.remark}
            onChange={(e) => setValue((v) => ({ ...v, remark: e.target.value }))}
          />
        </label>
      )}
    </div>
  )
}
