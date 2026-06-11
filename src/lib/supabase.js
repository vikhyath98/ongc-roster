import { createClient } from '@supabase/supabase-js'

// All data access goes through this single Supabase client (SPEC.md §2).
// Read env defensively: import.meta.env exists under Vite but is undefined in
// plain Node (e.g. when unit-testing pure helpers that live in this tree).
const env = import.meta.env ?? {}

// Normalise VITE_SUPABASE_URL down to its bare origin (scheme + host). The
// Supabase client appends its own paths (/auth/v1, /rest/v1, …), so the env
// var must be just "https://<ref>.supabase.co". A pasted value that includes a
// path or trailing slash (e.g. ".../rest/v1") otherwise produces broken request
// URLs like "/rest/v1/auth/v1/token". Reducing to origin makes prod robust to it.
function normaliseSupabaseUrl(raw) {
  const v = raw?.trim()
  if (!v) return v
  try {
    return new URL(v).origin
  } catch {
    return v.replace(/\/+$/, '')
  }
}

const supabaseUrl = normaliseSupabaseUrl(env.VITE_SUPABASE_URL)
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim()

// Fail loudly during development if env vars are missing, rather than
// producing confusing auth errors later.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your project values.'
  )
}

export const supabase = createClient(
  supabaseUrl ?? 'http://localhost',
  supabaseAnonKey ?? 'public-anon-key-missing',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
)
