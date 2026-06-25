import { useEffect, useRef, useState } from 'react'
import {
  listEmployeeDocuments,
  upsertEmployeeDocument,
  applicableDocTypes,
  docState,
  suggestedExpiry,
} from '../lib/documents'
import { uploadDocumentScan, getSignedUrl } from '../lib/storage'

const MAX_SCAN_BYTES = 5 * 1024 * 1024 // 5 MB

const STATE_PILL = {
  'verified-current': { cls: 'pill--ok', label: 'Verified' },
  expired: { cls: 'pill--bad', label: 'Expired' },
  unverified: { cls: 'pill--warn', label: 'Not verified' },
  missing: { cls: 'pill--bad', label: 'Missing' },
}

function blankEdit() {
  return { status: 'pending', issue_date: '', expiry_date: '', document_number: '', date_of_birth: '' }
}

function editFromDoc(doc) {
  return doc
    ? {
        status: doc.status ?? 'pending',
        issue_date: doc.issue_date ?? '',
        expiry_date: doc.expiry_date ?? '',
        document_number: doc.document_number ?? '',
        date_of_birth: doc.date_of_birth ?? '',
      }
    : blankEdit()
}

// Per-employee document checklist (SPEC.md §5.2, §6.4).
export default function EmployeeDocChecklist({ employee, docTypes, userId, onChanged }) {
  const [docs, setDocs] = useState(null) // employee_documents rows
  const [edits, setEdits] = useState({}) // docTypeId -> {status,issue,expiry}
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')
  const [scanningId, setScanningId] = useState(null) // docTypeId being uploaded
  const [scanErr, setScanErr] = useState({}) // docTypeId -> message
  const scanInputs = useRef({}) // docTypeId -> hidden <input>

  // Attach (or replace) a document scan. Uploads immediately; if the document
  // has no employee_documents row yet, create one first so we have an id to
  // record file_path on.
  async function onScanSelect(dt, empDoc, file) {
    if (!file) return
    setScanErr((s) => ({ ...s, [dt.id]: '' }))
    if (file.size > MAX_SCAN_BYTES) {
      setScanErr((s) => ({ ...s, [dt.id]: 'File too large (max 5 MB)' }))
      return
    }
    setScanningId(dt.id)
    let docId = empDoc?.id
    if (!docId) {
      const { data, error: cErr } = await upsertEmployeeDocument(
        employee.id,
        dt.id,
        edits[dt.id] ?? blankEdit(),
        userId
      )
      if (cErr || !data) {
        setScanningId(null)
        setScanErr((s) => ({ ...s, [dt.id]: 'Upload failed, try again.' }))
        return
      }
      docId = data.id
    }
    const { error: upErr } = await uploadDocumentScan(employee.id, docId, dt.id, file)
    setScanningId(null)
    if (upErr) {
      setScanErr((s) => ({ ...s, [dt.id]: 'Upload failed, try again.' }))
      return
    }
    await load()
    onChanged?.()
  }

  // Open a scan in a new tab via a fresh signed URL (never cached).
  async function openScan(path) {
    const url = await getSignedUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const applicable = applicableDocTypes(employee.designation_id, docTypes)

  async function load() {
    const { data, error: err } = await listEmployeeDocuments(employee.id)
    if (err) {
      setError(err.message)
      return
    }
    setDocs(data ?? [])
    const byType = new Map((data ?? []).map((d) => [d.document_type_id, d]))
    const next = {}
    for (const dt of applicable) next[dt.id] = editFromDoc(byType.get(dt.id))
    setEdits(next)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id])

  if (error) return <p className="banner banner--error">{error}</p>
  if (docs === null) return <p className="muted">Loading documents…</p>

  const byType = new Map(docs.map((d) => [d.document_type_id, d]))

  function setField(dtId, key, value) {
    setEdits((e) => {
      const cur = { ...e[dtId], [key]: value }
      // Auto-suggest expiry from issue date + default validity, if expiry empty.
      if (key === 'issue_date') {
        const dt = applicable.find((d) => d.id === dtId)
        if (dt?.default_validity_days && !cur.expiry_date) {
          cur.expiry_date = suggestedExpiry(value, dt.default_validity_days)
        }
      }
      return { ...e, [dtId]: cur }
    })
  }

  function isDirty(dtId) {
    const orig = editFromDoc(byType.get(dtId))
    const cur = edits[dtId] ?? blankEdit()
    return (
      orig.status !== cur.status ||
      orig.issue_date !== cur.issue_date ||
      orig.expiry_date !== cur.expiry_date ||
      orig.document_number !== cur.document_number ||
      orig.date_of_birth !== cur.date_of_birth
    )
  }

  async function save(dtId) {
    setSavingId(dtId)
    setError('')
    const { error: err } = await upsertEmployeeDocument(
      employee.id,
      dtId,
      edits[dtId],
      userId
    )
    setSavingId(null)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    onChanged?.()
  }

  return (
    <div className="doc-checklist">
      {applicable.length === 0 && (
        <p className="muted">No document requirements for this designation.</p>
      )}
      {applicable.map((dt) => {
        const empDoc = byType.get(dt.id)
        const state = docState(dt, empDoc)
        const pill = STATE_PILL[state]
        const edit = edits[dt.id] ?? blankEdit()
        return (
          <div className="doc-card" key={dt.id}>
            <div className="doc-card__head">
              <div className="doc-card__title">
                <span>{dt.name}</span>
                {!dt.is_required && <span className="pill pill--muted">Optional</span>}
              </div>
              <span className={`pill ${pill.cls}`}>{pill.label}</span>
            </div>

            <div className="doc-card__fields">
              <label className="field field--inline">
                <span>Status</span>
                <select
                  value={edit.status}
                  onChange={(e) => setField(dt.id, 'status', e.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="submitted">Submitted</option>
                  <option value="verified">Verified</option>
                </select>
              </label>

              {/* Number and dates render independently: Passport tracks both,
                  Aadhaar/PAN track only a number, most docs only dates. */}
              {dt.tracks_number && (
                <>
                  <label className="field field--inline doc-card__number">
                    <span>Document number (optional)</span>
                    <input
                      value={edit.document_number}
                      onChange={(e) => setField(dt.id, 'document_number', e.target.value)}
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  {/* Full-width own row so DOB isn't visually paired with Issue date. */}
                  <label className="field field--inline" style={{ gridColumn: '1 / -1' }}>
                    <span>Date of birth</span>
                    <input
                      type="date"
                      value={edit.date_of_birth}
                      onChange={(e) => setField(dt.id, 'date_of_birth', e.target.value)}
                    />
                  </label>
                </>
              )}
              {dt.tracks_dates && (
                <>
                  <label className="field field--inline">
                    <span>Issue date</span>
                    <input
                      type="date"
                      value={edit.issue_date}
                      onChange={(e) => setField(dt.id, 'issue_date', e.target.value)}
                    />
                  </label>
                  <label className="field field--inline">
                    <span>
                      Expiry date
                      {dt.default_validity_days ? ` (${dt.default_validity_days}d default)` : ''}
                    </span>
                    <input
                      type="date"
                      value={edit.expiry_date}
                      onChange={(e) => setField(dt.id, 'expiry_date', e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="doc-card__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!isDirty(dt.id) || savingId === dt.id}
                onClick={() => save(dt.id)}
              >
                {savingId === dt.id ? 'Saving…' : isDirty(dt.id) ? 'Save' : 'Saved'}
              </button>

              {empDoc?.file_path && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => openScan(empDoc.file_path)}
                >
                  📎 View
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={scanningId === dt.id}
                onClick={() => scanInputs.current[dt.id]?.click()}
              >
                {scanningId === dt.id ? 'Uploading…' : empDoc?.file_path ? '📎 Replace' : '📎 Scan'}
              </button>
              {scanErr[dt.id] && <span className="doc-card__scan-err">{scanErr[dt.id]}</span>}
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                hidden
                ref={(el) => (scanInputs.current[dt.id] = el)}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  onScanSelect(dt, empDoc, f)
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
