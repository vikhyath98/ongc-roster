import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { MENU_ITEMS } from './BottomNav'

// Slide-in drawer opened from the header hamburger. Holds the secondary
// destinations (Employee Master, Configuration) plus identity + sign out,
// keeping them out of the thumb-zone bottom nav.
export default function SettingsMenu({ open, who, onClose, onSignOut }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__head">
          <span className="drawer__who" title={who}>
            {who}
          </span>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <nav className="drawer__nav" aria-label="Secondary">
          {MENU_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                'drawer__item' + (isActive ? ' drawer__item--active' : '')
              }
              onClick={onClose}
            >
              <span className="drawer__item-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button type="button" className="btn btn--ghost drawer__signout" onClick={onSignOut}>
          Sign out
        </button>
      </aside>
    </div>
  )
}
