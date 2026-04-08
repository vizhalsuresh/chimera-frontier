import { motion, type HTMLMotionProps, type AnimationDefinition } from 'framer-motion'
import { useState } from 'react'
import { soundEngine } from '../lib/soundEngine'

// Omit children + onAnimationComplete to re-declare with tighter types
interface CyberCardProps extends Omit<HTMLMotionProps<'div'>, 'children' | 'onAnimationComplete'> {
  children?: React.ReactNode
  /** Suppress the scanline whoosh on reveal. */
  noSound?: boolean
  onAnimationComplete?: (def: AnimationDefinition) => void
}

/**
 * Drop-in replacement for <motion.div className="card"> with:
 * - scanline sweep highlight on reveal
 * - soft glow border on hover
 * - scanline whoosh sound on first reveal
 * - participates in parent stagger via `variants` prop
 */
export function CyberCard({
  children,
  noSound = false,
  style,
  className,
  variants,
  onAnimationComplete,
  ...rest
}: CyberCardProps) {
  const [swept, setSwept] = useState(false)

  function handleAnimationComplete(def: AnimationDefinition) {
    if (def === 'show' && !swept) {
      setSwept(true)
      if (!noSound) soundEngine.scanline()
    }
    onAnimationComplete?.(def)
  }

  return (
    <motion.div
      className={className ?? 'card'}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
      variants={variants}
      whileHover={{
        boxShadow: '0 0 0 1px rgba(142,255,113,0.28), 0 0 22px rgba(142,255,113,0.07)',
        borderColor: 'rgba(142,255,113,0.32)',
        transition: { duration: 0.2 },
      }}
      onAnimationComplete={handleAnimationComplete}
      {...rest}
    >
      {children}

      {/* Scanline sweep — mounts after card becomes visible, runs once via CSS */}
      {swept && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 2,
            top: 0,
            background: 'linear-gradient(90deg, transparent, rgba(142,255,113,0.75), transparent)',
            pointerEvents: 'none',
            zIndex: 10,
            animation: 'cardScanline 0.48s ease-out forwards',
          }}
        />
      )}
    </motion.div>
  )
}
