import { useEffect, useState } from 'react'
import { getSignedUrl } from '../lib/storage'

// Display-only circular avatar for a stored identity photo (SPEC.md §17.P).
// Fetches its own short-lived signed URL on mount, so a list of these resolves
// progressively without blocking the render. Renders nothing until it has a
// path AND a resolved URL — callers decide the no-photo fallback.
export default function EmployeeAvatar({ path, name = '', size = 32 }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let active = true
    setUrl(null)
    if (!path) return
    getSignedUrl(path).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [path])

  if (!path || !url) return null
  return (
    <img
      className="avatar"
      style={{ width: size, height: size }}
      src={url}
      alt={name ? `${name} photo` : 'Employee photo'}
    />
  )
}
