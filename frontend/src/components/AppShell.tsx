import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { PropsWithChildren } from 'react'
import { useSound } from '../hooks/useSound'

function SoundToggle() {
  const { muted, toggleMute } = useSound()
  return (
    <button
      onClick={toggleMute}
      title={muted ? 'Unmute sounds' : 'Mute sounds'}
      style={{
        marginTop: 'auto',
        background: 'none',
        border: `1px solid ${muted ? 'rgba(255,255,255,0.12)' : 'rgba(142,255,113,0.25)'}`,
        color: muted ? 'rgba(255,255,255,0.25)' : '#8eff71',
        fontSize: 9,
        letterSpacing: '0.14em',
        padding: '6px 10px',
        cursor: 'pointer',
        textTransform: 'uppercase',
        transition: 'all 0.15s',
        borderRadius: 4,
      }}
    >
      {muted ? 'SND: OFF' : 'SND: ON'}
    </button>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  return (
    <div className="shell">
      <aside className="sidebar">
        <h2 className="brand">Miraie React</h2>

        <Link className={pathname === '/' ? 'nav active' : 'nav'} to="/">
          Dashboard
        </Link>
        <Link className={pathname.includes('/scheduler') ? 'nav active' : 'nav'} to="/scheduler">
          Scheduler
        </Link>

        <SoundToggle />
      </aside>

      <main className="main">
        {/* Ambient scanline sweep */}
        <motion.div
          className="scanline"
          initial={{ y: -20, opacity: 0.2 }}
          animate={{ y: ['-10%', '110%'], opacity: [0.12, 0.22, 0.12] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'linear' }}
        />
        {children}
      </main>
    </div>
  )
}
