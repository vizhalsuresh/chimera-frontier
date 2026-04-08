import { motion, type HTMLMotionProps } from 'framer-motion'
import { soundEngine } from '../lib/soundEngine'

export type CyberSoundType = 'click' | 'toggle' | 'none'

// Omit children so we can accept ReactNode only (HTMLMotionProps<'button'> allows MotionValue)
interface CyberButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: React.ReactNode
  /** Which sound to play on press. Defaults to 'click'. */
  soundType?: CyberSoundType
}

/**
 * Drop-in replacement for <button> with:
 * - hover blip sound + glow overlay
 * - press sound (click zap or mechanical toggle) synced with whileTap animation
 * - All native button + Framer Motion props forwarded
 */
export function CyberButton({
  children,
  soundType = 'click',
  disabled,
  style,
  onClick,
  onMouseEnter,
  onPointerDown,
  whileHover,
  whileTap,
  ...rest
}: CyberButtonProps) {

  function handleMouseEnter(e: React.MouseEvent<HTMLButtonElement>) {
    if (!disabled && soundType !== 'none') soundEngine.hover()
    onMouseEnter?.(e)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!disabled && soundType !== 'none') {
      soundType === 'toggle' ? soundEngine.toggle() : soundEngine.click()
    }
    onPointerDown?.(e)
  }

  return (
    <motion.button
      {...rest}
      disabled={disabled}
      style={{ position: 'relative', overflow: 'hidden', ...style }}
      whileHover={!disabled ? (whileHover ?? { scale: 1.04, filter: 'brightness(1.18)' }) : undefined}
      whileTap={!disabled ? (whileTap ?? { scale: 0.94, filter: 'brightness(1.9)' }) : undefined}
      transition={{ duration: 0.11 }}
      onMouseEnter={handleMouseEnter}
      onPointerDown={handlePointerDown}
      onClick={onClick}
    >
      {children}

      {/* Radial glow overlay — visible on hover */}
      <motion.span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          borderRadius: 'inherit',
          background: 'radial-gradient(circle at 50% 50%, rgba(142,255,113,0.14), transparent 72%)',
          opacity: 0,
        }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.14 }}
      />
    </motion.button>
  )
}
