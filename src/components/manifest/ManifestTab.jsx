import { useState } from 'react'
import ManifestBoard from './ManifestBoard'
import ManifestRequests from './ManifestRequests'
import ManifestRfms from './ManifestRfms'
import ManualOnboard from './ManualOnboard'

const NAV = [
  ['board', 'Board'],
  ['requests', 'Requests'],
  ['rfms', 'RFMs'],
]

// The Manifest tab (Flow B, §17.K): the status board is the default triage view.
// Requests and RFMs remain reachable via the secondary nav for creating/logging
// RFMs, editing requests, and recording boarding outcomes. Manual onboard
// (exception) stays as the low-prominence escape hatch.
export default function ManifestTab({ userId }) {
  const [view, setView] = useState('board')
  const [manualOpen, setManualOpen] = useState(false)
  // Bump to force the views to remount/reload after a manual onboard.
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="manifest-tab">
      <div className="manifest-tab__nav">
        {NAV.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={'linkish' + (view === key ? ' manifest-tab__nav--on' : '')}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'board' && <ManifestBoard key={`board-${reloadKey}`} userId={userId} />}
      {view === 'requests' && <ManifestRequests key={`req-${reloadKey}`} userId={userId} />}
      {view === 'rfms' && <ManifestRfms key={`rfm-${reloadKey}`} userId={userId} />}

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
