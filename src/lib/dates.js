// Date helpers. All app dates are calendar dates ('YYYY-MM-DD') in the
// operator's local timezone (IST), so we avoid naive UTC slicing which can
// roll a day at the IST/UTC boundary.

export function todayISO() {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

// Inclusive day count: day 1 = the start date (SPEC.md §3.1).
// e.g. sign-on today => 1 day served.
export function daysInclusive(startISO, endISO = todayISO()) {
  if (!startISO) return 0
  const start = new Date(startISO + 'T00:00:00')
  const end = new Date(endISO + 'T00:00:00')
  return Math.floor((end - start) / 86400000) + 1
}

// Add days to an ISO date, returning ISO.
export function addDays(startISO, days) {
  if (!startISO) return ''
  const d = new Date(startISO + 'T00:00:00')
  d.setDate(d.getDate() + Number(days || 0))
  return d.toISOString().slice(0, 10)
}
