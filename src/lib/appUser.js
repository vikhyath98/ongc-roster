import { supabase } from './supabase'

// Ensure a public.app_users row exists for the signed-in auth user.
// FKs like rotation_log.onboarded_by / employee_documents.verified_by point at
// app_users(id), so every manager who acts in the app needs a row here.
//
// A DB trigger (migrations/0003_app_users_link.sql) does this server-side too;
// this client-side upsert is a safety net and keeps email/name current.
// Only columns we actually have are sent, so we never clobber a name the
// trigger captured from signup metadata.
export async function ensureAppUser(user) {
  if (!user?.id) return { error: null }

  const payload = { id: user.id, email: user.email ?? null }
  const name =
    user.user_metadata?.full_name ?? user.user_metadata?.name ?? null
  if (name) payload.full_name = name

  const { error } = await supabase
    .from('app_users')
    .upsert(payload, { onConflict: 'id' })

  if (error) {
    // Non-fatal: the user can still use the app; log for diagnosis.
    // eslint-disable-next-line no-console
    console.warn('[app_users] ensure row failed:', error.message)
  }
  return { error }
}

// Fetch the manager's profile row (role, full_name, …).
export async function fetchAppUser(userId) {
  if (!userId) return { data: null, error: null }
  return supabase.from('app_users').select('*').eq('id', userId).maybeSingle()
}
