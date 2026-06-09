import { NavLink } from 'react-router-dom'

// The 8 modules from SPEC.md §5. Short labels + glyphs so they fit a phone.
// Horizontally scrollable so all 8 are reachable one-handed.
export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/employees', label: 'Staff', icon: '👤' },
  { to: '/roster', label: 'Roster', icon: '📋' },
  { to: '/boarding', label: 'Board', icon: '🚁' },
  { to: '/replacement', label: 'Replace', icon: '🔁' },
  { to: '/reserve', label: 'Reserve', icon: '✅' },
  { to: '/penalties', label: 'Penalty', icon: '⚠️' },
  { to: '/configuration', label: 'Config', icon: '⚙️' },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            'bottom-nav__item' + (isActive ? ' bottom-nav__item--active' : '')
          }
        >
          <span className="bottom-nav__icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="bottom-nav__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
