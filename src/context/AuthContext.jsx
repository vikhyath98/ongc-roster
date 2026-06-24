import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureAppUser, fetchAppUser } from '../lib/appUser'

const AuthContext = createContext(null)

// Role gate (SPEC.md §17.M). Admin always passes, whatever roles are listed.
export function hasRole(profile, ...roles) {
  if (profile?.role === 'admin') return true
  return roles.includes(profile?.role)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // When a session appears, make sure the app_users row exists and load
    // the manager's profile. Kept off the initial render path so a slow
    // network never blocks showing the app.
    async function linkProfile(user) {
      if (!user) {
        setProfile(null)
        return
      }
      await ensureAppUser(user)
      const { data } = await fetchAppUser(user.id)
      let prof = data
      // A catering manager can be scoped to several installations via the
      // app_user_installations junction. Load them and attach as profile
      // .installations BEFORE exposing the profile, so consumers (CM view,
      // Roster scoping) never see a half-loaded profile.
      if (prof?.role === 'catering_manager') {
        const { data: rows } = await supabase
          .from('app_user_installations')
          .select('installation_id, installation:installations(id, name)')
          .eq('user_id', prof.id)
        prof = { ...prof, installations: (rows ?? []).map((r) => r.installation).filter(Boolean) }
      }
      if (active) setProfile(prof)
    }

    // Load any persisted session on first mount.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
      linkProfile(data.session?.user ?? null)
    })

    // Keep state in sync with sign-in / sign-out / token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      linkProfile(newSession?.user ?? null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      installations: profile?.installations ?? [],
      loading,
      // Email/password auth needs no redirectTo (that is only for magic links
      // and OAuth), so none is passed — login works on any domain.
      signIn: (email, password) =>
        supabase.auth.signInWithPassword({ email, password }),
      signOut: () => supabase.auth.signOut(),
    }),
    [session, profile, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
