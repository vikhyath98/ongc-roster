// Throwaway connectivity check: confirms the Supabase URL + publishable key
// reach the project. Does NOT need the schema applied — a "table missing"
// error still proves the credentials and endpoint are valid.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
console.log('URL:', url)
console.log('Key prefix:', key?.slice(0, 16) + '…')

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(url, key)

// 1) Auth endpoint reachable?
const { error: authErr } = await supabase.auth.getSession()
console.log('auth.getSession:', authErr ? 'ERROR ' + authErr.message : 'OK')

// 2) PostgREST reachable? (app_config may or may not exist yet)
const { data, error } = await supabase.from('app_config').select('key,value')
if (error) {
  console.log('app_config query error code:', error.code)
  console.log('app_config query message:', error.message)
  if (error.code === '42P01' || /does not exist/i.test(error.message)) {
    console.log('=> Connection OK. Schema not applied yet (expected).')
  }
} else {
  console.log('=> Connection OK. app_config rows:', data.length)
  console.table(data)
}
