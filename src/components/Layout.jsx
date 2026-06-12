import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BottomNav, { ALL_NAV } from './BottomNav'
import SettingsMenu from './SettingsMenu'

export default function Layout() {
  const { user, profile, signOut } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const who = profile?.full_name || user?.email || 'Signed in'

  const current =
    ALL_NAV.find((i) =>
      i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)
    ) ?? ALL_NAV[0]

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__titles">
          <span className="app-header__brand">ONGC Rotation</span>
          <h1 className="app-header__page">{current.label}</h1>
        </div>
        <button
          type="button"
          className="app-header__menu"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          ☰
        </button>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <BottomNav />

      <SettingsMenu
        open={menuOpen}
        who={who}
        onClose={() => setMenuOpen(false)}
        onSignOut={() => {
          setMenuOpen(false)
          signOut()
        }}
      />
    </div>
  )
}
