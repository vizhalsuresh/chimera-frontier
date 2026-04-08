import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, type PropsWithChildren } from 'react'
import { soundEngine } from '../lib/soundEngine'
import { pageGlitch } from '../lib/animationVariants'

interface PageTransitionProps extends PropsWithChildren {
  /** Pass `location.pathname` — changes trigger the transition. */
  locationKey: string
}

/**
 * Wraps route content with:
 * - glitch-enter / glitch-exit animation (brightness flash + blur + shift)
 * - bass-thud transition sound on every navigation (skips first mount)
 */
export function PageTransition({ children, locationKey }: PageTransitionProps) {
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    soundEngine.transition()
  }, [locationKey])

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={locationKey}
        variants={pageGlitch}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ width: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
