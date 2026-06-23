import { supabase } from './supabase'

// app_config is a key/value table of text values (SPEC.md §4). These helpers
// load it as a map and read typed values with sensible fallbacks.

export const CONFIG_DEFAULTS = {
  min_service_days: 56,
  warning_day: 65,
  max_service_days: 70,
  penalty_rate: 1000,
  confirmation_validity_days: 14,
  nedp_validity_days: 365,
}

export async function getAppConfig() {
  const { data, error } = await supabase.from('app_config').select('key,value')
  if (error) return { config: {}, error }
  const config = {}
  for (const row of data) config[row.key] = row.value
  return { config, error: null }
}

export function configInt(config, key, fallback = CONFIG_DEFAULTS[key]) {
  const n = parseInt(config?.[key], 10)
  return Number.isFinite(n) ? n : fallback
}
