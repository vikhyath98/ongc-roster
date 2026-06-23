import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { daysInclusive } from '../../lib/dates'

// Skill-tier compatibility (SPEC.md §17.I), kept in sync with reserve.js:
// a candidate can fill an outgoing role only if their tier is >= the outgoing's.
const SKILL_TIER = {
  skilled: 3,
  'semi-skilled': 2,
  unskilled: 1,
  outsourced: 0,
}
const tierOf = (cat) => SKILL_TIER[(cat ?? '').toLowerCase()] ?? 1

// Shared "add a relief line item" sub-form, used by the new-request form, the
// request detail (add to existing), and the ad-hoc RFM add flow. Enforces the
// confirmed-only incoming picker, the optional offshore "replacing" field with
// the day-56 gate + emergency exception, the designation-matching rule, and
// dedupe against employees already used. Calls onAdd with
// { employeeId, replacingEmployeeId, reason, isEmergencyException, exceptionReason }.
export default function LineItemPicker({
  installationId,
  candidates,
  designations,
  requirements,
  offshore,
  thresholds,
  usedIds,
  onAdd,
  addLabel = '＋ Add line item',
}) {
  const [incomingId, setIncomingId] = useState('')
  const [replacingId, setReplacingId] = useState('')
  const [itemReason, setItemReason] = useState('')
  const [emergencyOn, setEmergencyOn] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')

  function reset() {
    setIncomingId('')
    setReplacingId('')
    setItemReason('')
    setEmergencyOn(false)
    setExceptionReason('')
  }

  const desigName = useMemo(() => new Map(designations.map((d) => [d.id, d.name])), [designations])
  const catByDesig = useMemo(
    () => new Map(designations.map((d) => [d.id, d.category?.name])),
    [designations]
  )

  const relevantDesigIds = useMemo(() => {
    const s = new Set()
    for (const r of requirements) if (r.installation_id === installationId) s.add(r.designation_id)
    return s
  }, [requirements, installationId])

  const confirmedCandidates = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.employment_status === 'active' &&
          c.liveConfirmed &&
          !usedIds.has(c.id) &&
          (relevantDesigIds.size === 0 || relevantDesigIds.has(c.designation_id))
      ),
    [candidates, usedIds, relevantDesigIds]
  )

  const missingDesigs = useMemo(() => {
    if (relevantDesigIds.size === 0) return []
    const have = new Set(confirmedCandidates.map((c) => c.designation_id))
    return [...relevantDesigIds].filter((id) => !have.has(id)).map((id) => desigName.get(id) ?? '—')
  }, [relevantDesigIds, confirmedCandidates, desigName])

  const offshoreHere = useMemo(
    () =>
      offshore.filter((s) => s.installation_id === installationId && !usedIds.has(s.employee?.id)),
    [offshore, installationId, usedIds]
  )

  const replacingStint = offshoreHere.find((s) => s.employee?.id === replacingId) ?? null
  const replacingDays = replacingStint ? daysInclusive(replacingStint.sign_on_date) : null
  const under56 = replacingDays != null && replacingDays < thresholds.min
  const warn65 = replacingDays != null && replacingDays >= thresholds.warning

  const incoming = candidates.find((c) => c.id === incomingId) ?? null
  const incomingDesig = incoming?.designation
  const outgoingDesig = replacingStint?.employee?.designation

  // Skill-tier replacement rule (SPEC.md §17.I), in sync with reserve.js: exact
  // designation passes silently; a higher/equal tier cross-designation warns; a
  // lower tier is a hard block, and an Outsourced role is a closed group (only
  // another Outsourced can fill it).
  let desigBlock = null
  let desigWarn = null
  if (
    incoming &&
    replacingStint &&
    incomingDesig?.id &&
    outgoingDesig?.id &&
    incomingDesig.id !== outgoingDesig.id
  ) {
    const inCat = catByDesig.get(incomingDesig.id)
    const outCat = catByDesig.get(outgoingDesig.id)
    const outLower = (outCat ?? '').toLowerCase()
    if (outLower === 'outsourced') {
      if ((inCat ?? '').toLowerCase() !== 'outsourced')
        desigBlock = `${outgoingDesig.name} can only be replaced by another ${outgoingDesig.name}.`
    } else if (tierOf(inCat) < tierOf(outCat)) {
      desigBlock = `${incomingDesig.name} (${inCat ?? 'unknown tier'}) cannot replace ${outgoingDesig.name} (${outCat}).`
    } else {
      desigWarn = `⚠️ ${incomingDesig.name} is replacing ${outgoingDesig.name} — cross-designation. Confirm this is intended.`
    }
  }

  const canAdd =
    Boolean(incomingId) &&
    !desigBlock &&
    (!replacingId || !under56 || (emergencyOn && exceptionReason.trim().length > 0))

  function handleAdd() {
    if (!canAdd) return
    const isException = Boolean(replacingId) && under56 && emergencyOn
    onAdd({
      employeeId: incomingId,
      replacingEmployeeId: replacingId || null,
      reason: replacingId ? null : itemReason.trim() || null,
      isEmergencyException: isException,
      exceptionReason: isException ? exceptionReason.trim() : null,
    })
    reset()
  }

  if (!installationId) return null

  return (
    <>
      {missingDesigs.length > 0 && (
        <p className="banner banner--warn">
          No confirmed {missingDesigs.join(', ')} candidate{missingDesigs.length === 1 ? '' : 's'}{' '}
          available. Confirm availability first —{' '}
          <Link to="/roster?tab=base&confirm=unconfirmed">go to Base staff</Link>.
        </p>
      )}

      <label className="field">
        <span>Incoming / relief employee * (confirmed only)</span>
        <select value={incomingId} onChange={(e) => setIncomingId(e.target.value)}>
          <option value="">Select…</option>
          {confirmedCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name} — {c.designation?.name ?? '—'}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Replacing (offshore here, optional)</span>
        <select
          value={replacingId}
          onChange={(e) => {
            setReplacingId(e.target.value)
            setEmergencyOn(false)
            setExceptionReason('')
          }}
        >
          <option value="">— not a direct replacement —</option>
          {offshoreHere.map((s) => (
            <option key={s.id} value={s.employee?.id}>
              {s.employee?.full_name} — {s.employee?.designation?.name ?? '—'} (
              {daysInclusive(s.sign_on_date)}d)
            </option>
          ))}
        </select>
      </label>

      {desigBlock && <p className="banner banner--error">{desigBlock}</p>}
      {desigWarn && <p className="banner banner--warn">{desigWarn}</p>}

      {!replacingId && (
        <label className="field">
          <span>Reason (optional)</span>
          <input value={itemReason} onChange={(e) => setItemReason(e.target.value)} />
        </label>
      )}

      {under56 && (
        <div className="banner banner--error">
          <p style={{ margin: 0 }}>
            Cannot request a replacement for {replacingStint.employee?.full_name} — only{' '}
            {replacingDays} days served. Manifesting before day {thresholds.min} risks an understay
            penalty.
          </p>
          <label className="checkrow" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={emergencyOn}
              onChange={(e) => setEmergencyOn(e.target.checked)}
            />
            <span>Emergency exception</span>
          </label>
          {emergencyOn && (
            <label className="field" style={{ marginTop: 8 }}>
              <span>Exception reason *</span>
              <textarea
                rows={2}
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      {warn65 && (
        <p className="banner banner--warn">
          This employee is on day {replacingDays} — the safe manifesting window (day{' '}
          {thresholds.min}–{thresholds.warning}) has closed. Any resulting overstay is likely to
          default toward SKFS responsibility.
        </p>
      )}

      <button
        type="button"
        className="btn btn--ghost"
        disabled={!canAdd}
        onClick={handleAdd}
        style={{ marginTop: 10 }}
      >
        {addLabel}
      </button>
    </>
  )
}
