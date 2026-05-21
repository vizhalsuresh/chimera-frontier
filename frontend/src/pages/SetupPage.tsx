import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { CyberCard } from '../components/CyberCard'
import { CyberButton } from '../components/CyberButton'
import { motion } from 'framer-motion'
import { soundEngine } from '../lib/soundEngine'
import { useNavigate } from 'react-router-dom'

export function SetupPage() {
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    soundEngine.click()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const { error } = await supabase.functions.invoke('miraie-setup', {
        body: { mobile, password }
      })

      if (error) throw error

      soundEngine.success()
      setSuccess(true)
      setTimeout(() => navigate('/'), 2000)
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Setup failed')
      soundEngine.error()
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="page"
    >
      <div className="row">
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 4 }}>
            System_Initialization
          </div>
          <h1 className="pageTitle">Link_Miraie_AC</h1>
        </div>
      </div>

      <CyberCard style={{ maxWidth: 500, padding: 32 }}>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
          Enter your official <b>MirAIe</b> app credentials to allow this dashboard to communicate with your AC unit. 
          Your password is never stored; it is only used to generate a secure access token.
        </p>

        {success ? (
          <div style={{ color: '#8eff71', textAlign: 'center', padding: '20px 0' }}>
            <h2 style={{ margin: 0 }}>INITIALIZATION_COMPLETE ✓</h2>
            <p>Redirecting to dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSetup}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase' }}>Miraie Mobile Number</label>
              <input
                type="text"
                placeholder="+91XXXXXXXXXX"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                required
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase' }}>Miraie Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%' }}
              />
            </div>

            {error && (
              <div style={{ color: '#ff7351', fontSize: 12, marginBottom: 20, background: 'rgba(255,115,81,0.1)', padding: 12, border: '1px solid #ff7351' }}>
                ERROR: {error}
              </div>
            )}

            <CyberButton 
              type="submit" 
              className="primaryBtn" 
              style={{ width: '100%', height: 48 }}
              disabled={loading}
            >
              {loading ? 'CONNECTING_TO_NEXUS...' : 'AUTHORIZE_SYSTEM_LINK'}
            </CyberButton>
          </form>
        )}
      </CyberCard>
    </motion.div>
  )
}
