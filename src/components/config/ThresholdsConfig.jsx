import { useEffect, useState } from 'react'
import { getAppConfig, CONFIG_DEFAULTS } from '../../lib/config'
import { updateConfigValue } from '../../lib/configAdmin'
import { useAuth } from '../../context/AuthContext'

const FIELDS = [
  { key: 'min_service_days', label: 'Minimum service days (eligible to rotate)' },
  { key: 'warning_day', label: 'Warning day' },
  { key: 'max_service_days', label: 'Hard threshold (max service days)' },
  { key: 'penalty_rate', label: 'Penalty rate (₹ per person per day)' },
  { key: 'confirmation_validity_days', label: 'Confirmation validity (days)' },
]

export default function ThresholdsConfig() {
  const { user } = useAuth()
  const [values, setValues] = useState({})
  const [original, setOriginal] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const { config } = await getAppConfig()
    const v = {}
    for (const f of FIELDS) v[f.key] = String(config[f.key] ?? CONFIG_DEFAULTS[f.key] ?? '')
    setValues(v)
    setOriginal(v)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const changedKeys = FIELDS.map((f) => f.key).filter((k) => values[k] !== original[k])

  async function save() {
    setError('')
    setMsg('')
    for (const k of changedKeys) {
      const n = Number(values[k])
      if (!Number.isFinite(n) || n < 0) {
        setError(`${FIELDS.find((f) => f.key === k).label} must be a non-negative number.`)
        return
      }
    }
    setBusy(true)
    for (const k of changedKeys) {
      const { error: err } = await updateConfigValue(k, Number(values[k]), user?.id)
      if (err) {
        setBusy(false)
        setError(err.message)
        return
      }
    }
    setBusy(false)
    setMsg(`Saved ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}.`)
    setOriginal(values)
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div className="form-grid">
      <p className="muted">
        These drive the roster colour bands, penalty accrual, and confirmation expiry across the
        app. Changes apply the next time each screen loads.
      </p>
      {FIELDS.map((f) => (
        <label className="field" key={f.key}>
          <span>{f.label}</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={values[f.key] ?? ''}
            onChange={(e) => {
              setValues((v) => ({ ...v, [f.key]: e.target.value }))
              setMsg('')
            }}
          />
        </label>
      ))}

      {error && <p className="banner banner--error">{error}</p>}
      {msg && <p className="banner banner--info">{msg}</p>}

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || changedKeys.length === 0}
        onClick={save}
      >
        {busy ? 'Saving…' : changedKeys.length ? `Save ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}` : 'Saved'}
      </button>
    </div>
  )
}
