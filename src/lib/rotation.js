// Roster colour state from days served and the configurable thresholds
// (SPEC.md §6.2). Thresholds come from app_config (min/warning/max service days).
//
//   days <  min                 -> green  (in service)
//   min  <= days <  warning     -> teal   (eligible to rotate)
//   warning <= days < max       -> amber  (warning)
//   days >= max                 -> red    (over threshold / penalty risk)

export const ROTATION_STATES = {
  in_service: { label: 'In service', cls: 'state--green' },
  eligible: { label: 'Plan Rotation', cls: 'state--teal' },
  warning: { label: 'Warning', cls: 'state--amber' },
  over: { label: 'Over threshold', cls: 'state--red' },
}

export function rotationState(days, { min, warning, max }) {
  if (days >= max) return { key: 'over', ...ROTATION_STATES.over }
  if (days >= warning) return { key: 'warning', ...ROTATION_STATES.warning }
  if (days >= min) return { key: 'eligible', ...ROTATION_STATES.eligible }
  return { key: 'in_service', ...ROTATION_STATES.in_service }
}
