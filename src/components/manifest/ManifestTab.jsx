import { useState } from 'react'
import ManifestRequests from './ManifestRequests'
import ManifestRfms from './ManifestRfms'
import ManualOnboard from './ManualOnboard'

// The Manifest tab: the primary onboarding path. Two sub-views (Requests and
// RFMs) plus a secondary, out-of-the-way Manual onboard (exception) link.
export default function ManifestTab({ userId }) {
  const [sub, setSub] = useState('requests')
  const [manualOpen, setManualOpen] = useState(false)
  // Bump to force the sub-views to remount/reload after a manual onboard.
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="manifest-tab">
      <div className="seg seg--sub">
        <button
          type="button"
          className={'seg__btn' + (sub === 'requests' ? ' seg__btn--on' : '')}
          onClick={() => setSub('requests')}
        >
          Requests
        </button>
        <button
          type="button"
          className={'seg__btn' + (sub === 'rfms' ? ' seg__btn--on' : '')}
          onClick={() => setSub('rfms')}
        >
          RFMs
        </button>
      </div>

      {sub === 'requests' ? (
        <ManifestRequests key={`req-${reloadKey}`} userId={userId} />
      ) : (
        <ManifestRfms key={`rfm-${reloadKey}`} userId={userId} />
      )}

      <div className="manifest-manual">
        <button type="button" className="linkish" onClick={() => setManualOpen(true)}>
          Manual onboard (exception)…
        </button>
      </div>

      <ManualOnboard
        open={manualOpen}
        userId={userId}
        onClose={() => setManualOpen(false)}
        onDone={() => {
          setManualOpen(false)
          setReloadKey((k) => k + 1)
        }}
      />
    </div>
  )
}
