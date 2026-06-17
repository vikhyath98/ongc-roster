import { useState } from 'react'
import ManifestRequests from './ManifestRequests'
import ManifestRfms from './ManifestRfms'

// The Manifest tab: the primary onboarding path. Two sub-views (Requests and
// RFMs) plus a secondary Manual onboard (exception) entry point. Sub-views are
// filled in by their own commits.
export default function ManifestTab({ userId }) {
  const [sub, setSub] = useState('requests')

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

      {sub === 'requests' ? <ManifestRequests userId={userId} /> : <ManifestRfms userId={userId} />}
    </div>
  )
}
