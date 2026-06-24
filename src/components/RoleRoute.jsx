import { Navigate } from 'react-router-dom'
import { useAuth, hasRole } from '../context/AuthContext'

// Per-role landing screen (SPEC.md §17.M). The CHECK constraint guarantees role
// is one of the four valid values, so every blocked role lands somewhere it is
// allowed — no redirect loops.
const LANDING = {
  catering_manager: '/cm',
  ongc_head: '/ongc-head',
}

// Wraps a route element: renders it only if the signed-in user's role is allowed
// (admin always is); otherwise redirects to that role's permitted landing.
// Assumes ProtectedRoute already guarded the session.
export default function RoleRoute({ roles, children }) {
  const { session, profile } = useAuth()

  // Profile loads a moment after the session; hold rather than misfire a redirect.
  if (session && !profile) {
    return (
      <div className="centered-screen">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (hasRole(profile, ...roles)) return children
  return <Navigate to={LANDING[profile?.role] ?? '/'} replace />
}
