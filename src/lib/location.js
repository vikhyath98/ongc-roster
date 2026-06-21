// Base-location display tag (SPEC.md §14.9 F). Works on any object carrying
// base_location_type + recall_lead_time_days (employee or reserve candidate).
// Returns null when no type is set, so callers render nothing.
// 'hometown' is the DB enum value (constraint in migration 0006); its
// human-readable label is "Out of town". Change labels only, never the value.
const TYPE_LABEL = { guesthouse: '🏨 Guesthouse', hometown: '🏠 Out of town' }

export function baseLocationTag(obj) {
  const type = obj?.base_location_type
  if (!type || !TYPE_LABEL[type]) return null
  // Only show the recall suffix for a positive lead time; 0/null/'' show none.
  const recall = Number(obj.recall_lead_time_days)
  return recall > 0 ? `${TYPE_LABEL[type]} · ${recall}d recall` : TYPE_LABEL[type]
}
