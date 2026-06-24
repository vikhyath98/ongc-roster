import { useAuth } from '../context/AuthContext'

// Catering-manager landing (SPEC.md §17.M). Placeholder — the return-manifest
// workflow lands here in Workstream N. Shows who is signed in and the
// installation(s) they are scoped to (from app_user_installations, loaded into
// profile.installations by AuthContext).
export default function CMView() {
  const { profile, user } = useAuth()
  const installations = profile?.installations ?? []
  const who = profile?.full_name || user?.email || 'Catering manager'

  return (
    <section>
      <div className="dash-card">
        <div className="dash-card__head">
          <h3>Catering Manager</h3>
        </div>
        <p className="muted">
          Signed in as <strong>{who}</strong>
          {' · '}
          {installations.length > 0 ? (
            installations.map((i) => `📍 ${i.name}`).join('  ·  ')
          ) : (
            <em>no installation assigned</em>
          )}
        </p>
        <p className="cert-summary cert-summary--warn">
          CM view coming soon. Return manifest functionality will appear here.
        </p>
      </div>
    </section>
  )
}
