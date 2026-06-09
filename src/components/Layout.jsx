import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BottomNav, { NAV_ITEMS } from './BottomNav'

export default function Layout() {
  const { user, profile, signOut } = useAuth()
  const location = useLocation()
  const who = profile?.full_name || user?.email || 'Signed in'

  const current =
    NAV_ITEMS.find((i) =>
      i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)
    ) ?? NAV_ITEMS[0]

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__titles">
          <span className="app-header__brand">ONGC Rotation</span>
          <h1 className="app-header__page">{current.label}</h1>
        </div>
        <button
          type="button"
          className="app-header__signout"
          onClick={() => signOut()}
          title={`${who} — tap to sign out`}
        >
          Sign out
        </button>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  )
}
