import { Link, useLocation } from 'react-router-dom'
import type { PropsWithChildren } from 'react'
import { motion } from 'framer-motion'

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
      </aside>
      <main className="main">
        <motion.div
          className="scanline"
          initial={{ y: -20, opacity: 0.2 }}
          animate={{ y: ['-10%', '110%'], opacity: [0.15, 0.25, 0.15] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
        />
        {children}
      </main>
    </div>
  )
}
