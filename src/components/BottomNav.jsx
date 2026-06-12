import { NavLink } from 'react-router-dom'

// Primary bottom nav — 4 thumb-friendly destinations, no horizontal scroll.
// Find replacement + the reserve pool now live inside Roster; Employee Master
// and Configuration moved to the header menu (see MENU_ITEMS).
export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/roster', label: 'Roster', icon: '📋' },
  { to: '/boarding', label: 'Board', icon: '🚁' },
  { to: '/penalties', label: 'Penalty', icon: '⚠️' },
]

// Secondary destinations, reached from the header hamburger menu.
export const MENU_ITEMS = [
  { to: '/employees', label: 'Employee Master', icon: '👤' },
  { to: '/configuration', label: 'Configuration', icon: '⚙️' },
]

// All routable destinations, for the header to resolve the current page title.
export const ALL_NAV = [...NAV_ITEMS, ...MENU_ITEMS]

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
