import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { CyberCard } from './CyberCard'
import { CyberButton } from './CyberButton'
import { motion, AnimatePresence } from 'framer-motion'
import { soundEngine } from '../lib/soundEngine'

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)

  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setSession(session)
      } catch (err) {
        console.error('Failed to get session:', err)
        setAuthError('Connection failed. Verify Supabase keys.')
      } finally {
        setLoading(false)
      }
    }

    initSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError(null)
    soundEngine.click()

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setAuthError(error.message)
      soundEngine.error()
    } else {
      soundEngine.success()
    }
    setAuthLoading(false)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: '#8eff71', fontFamily: 'monospace', background: '#0a0f12' }}>
        INITIALIZING_SECURE_SESSION...
      </div>
    )
  }

  // Check for missing credentials
  const isMissingCreds = !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY

  if (isMissingCreds) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0f12', color: '#ff7351', padding: 40, textAlign: 'center', fontFamily: 'monospace' }}>
        <h1 style={{ fontSize: 24, marginBottom: 20 }}>🛑 CRITICAL_ERROR: MISSING_CREDENTIALS</h1>
        <p style={{ maxWidth: 600, lineHeight: 1.6 }}>
          The Supabase URL or Anon Key is missing from the environment variables.<br/><br/>
          Please check your Vercel Project Settings > Environment Variables.<br/>
          Ensure <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> are set.
        </p>
        <CyberButton onClick={() => window.location.reload()} style={{ marginTop: 24 }}>RETRY_CONNECTION</CyberButton>
      </div>
    )
  }

  if (!session) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0a0f12', padding: 20 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <CyberCard style={{ width: 340, padding: '32px 24px' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 4 }}>
                Auth_Required
              </div>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#fff' }}>Access_Terminal</h2>
            </div>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase' }}>Email_Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@nexus.com"
                  required
                  style={{
                    width: '100%',
                    background: '#141e24',
                    border: '1px solid #1d2b34',
                    padding: '10px 12px',
                    color: '#fff',
                    fontSize: 13,
                    outline: 'none',
                    borderRadius: 2
                  }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase' }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: '100%',
                    background: '#141e24',
                    border: '1px solid #1d2b34',
                    padding: '10px 12px',
                    color: '#fff',
                    fontSize: 13,
                    outline: 'none',
                    borderRadius: 2
                  }}
                />
              </div>

              <AnimatePresence>
                {authError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ color: '#ff7351', fontSize: 11, marginBottom: 16, overflow: 'hidden' }}
                  >
                    Error: {authError}
                  </motion.div>
                )}
              </AnimatePresence>

              <CyberButton
                type="submit"
                className="primaryBtn"
                style={{ width: '100%', height: 42 }}
                disabled={authLoading}
              >
                {authLoading ? 'AUTHENTICATING...' : 'ESTABLISH_LINK'}
              </CyberButton>
            </form>
          </CyberCard>
        </motion.div>
      </div>
    )
  }

  return <>{children}</>
}
