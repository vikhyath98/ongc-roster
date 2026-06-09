// End-to-end auth + app_users linkage check, at the data layer.
// Usage:  node scripts/check-auth.mjs <email> <password>
// Verifies: sign-in works, authenticated RLS lets you read app_config,
// and an app_users row exists / gets created for the signed-in user.
import { readFileSync } from 'node:fs'

const [, , email, password] = process.argv
if (!email || !password) {
  console.error('Usage: node scripts/check-auth.mjs <email> <password>')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

// 1) Sign in
const { data: auth, error: signInErr } = await supabase.auth.signInWithPassword({
  email,
  password,
})
if (signInErr) {
  console.error('Sign-in FAILED:', signInErr.message)
  process.exit(1)
}
const user = auth.user
console.log('Sign-in OK ->', user.email, '(', user.id, ')')

// 2) Authenticated RLS read
const { data: cfg, error: cfgErr } = await supabase
  .from('app_config')
  .select('key,value')
if (cfgErr) console.error('app_config read FAILED:', cfgErr.message)
else console.log('Authenticated read OK -> app_config rows:', cfg.length)

// 3) Ensure app_users row (mirrors src/lib/appUser.js)
const payload = { id: user.id, email: user.email }
const name = user.user_metadata?.full_name ?? user.user_metadata?.name
if (name) payload.full_name = name
const { error: upErr } = await supabase
  .from('app_users')
  .upsert(payload, { onConflict: 'id' })
if (upErr) console.error('app_users upsert FAILED:', upErr.message)

const { data: row, error: rowErr } = await supabase
  .from('app_users')
  .select('id,email,full_name,role')
  .eq('id', user.id)
  .maybeSingle()
if (rowErr) console.error('app_users read FAILED:', rowErr.message)
else console.log('app_users linkage OK ->', row)

await supabase.auth.signOut()
console.log('Done.')
