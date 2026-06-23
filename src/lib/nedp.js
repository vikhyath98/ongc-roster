import { todayISO, addDays } from './dates'

// NEDP validity status from an employee's nedp_valid_until (SPEC.md §17.J).
// Dates are ISO 'YYYY-MM-DD' strings, so lexical comparison is calendar-correct.
//   null            -> 'not_set'   (not issued / not enforced yet)
//   <= today        -> 'expired'
//   within 30 days  -> 'expiring'
//   otherwise       -> 'ok'
export function nedpStatus(validUntil, today = todayISO()) {
  if (!validUntil) return 'not_set'
  if (validUntil <= today) return 'expired'
  if (validUntil <= addDays(today, 30)) return 'expiring'
  return 'ok'
}

// Pill descriptor per status (consistent with the cert pills). 'not_set' maps
// to nothing — callers omit the pill entirely.
export const NEDP_PILL = {
  ok: { cls: 'pill--ok', label: 'NEDP valid' },
  expiring: { cls: 'pill--warn', label: 'NEDP expiring' },
  expired: { cls: 'pill--bad', label: 'NEDP expired' },
}
