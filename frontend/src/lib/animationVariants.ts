import type { Variants } from 'framer-motion'

// ── Card reveal ──────────────────────────────────────────────────────────────

/** Stagger parent for card grids */
export const staggerCards: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
}

/** Individual card: fade + lift + subtle scale */
export const cardReveal: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

// ── Grid cells (scheduler day grid) ─────────────────────────────────────────

export const staggerGrid: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

export const gridCell: Variants = {
  hidden: { opacity: 0, y: 6,  scaleY: 0.92 },
  show:   { opacity: 1, y: 0,  scaleY: 1,   transition: { duration: 0.22, ease: 'easeOut' } },
}

// ── Page / section reveal ────────────────────────────────────────────────────

/** Full page wrapper — glitch-enter, glitch-exit */
export const pageGlitch: Variants = {
  initial: {
    opacity: 0,
    x: -5,
    filter: 'brightness(2) blur(3px)',
  },
  animate: {
    opacity: 1,
    x: 0,
    filter: 'brightness(1) blur(0px)',
    transition: { duration: 0.26, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: 5,
    filter: 'brightness(1.8) blur(2px)',
    transition: { duration: 0.18, ease: 'easeIn' },
  },
}

// ── Timeline entry (scheduler) ───────────────────────────────────────────────

export const timelineEntry: Variants = {
  hidden: { opacity: 0, x: -10 },
  show:   { opacity: 1, x: 0,   transition: { duration: 0.24, ease: 'easeOut' } },
}

// ── Scanline wipe (CSS-clip based, for use as inline `animate` target) ───────

export const scanlineWipe: Variants = {
  hidden:  { clipPath: 'inset(0 0 100% 0)', opacity: 0 },
  visible: { clipPath: 'inset(0 0 0% 0)',   opacity: 1, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
}

// ── Ambient glow pulse ───────────────────────────────────────────────────────

export const glowPulse: Variants = {
  idle: {
    boxShadow: '0 0 0px rgba(142,255,113,0)',
  },
  active: {
    boxShadow: [
      '0 0 4px rgba(142,255,113,0.25)',
      '0 0 14px rgba(142,255,113,0.55)',
      '0 0 4px rgba(142,255,113,0.25)',
    ],
    transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
  },
}
