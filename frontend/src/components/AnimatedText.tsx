import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

type Props = {
  lines: string[]
  speedMs?: number
}

export function AnimatedText({ lines, speedMs = 30 }: Props) {
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)
  const active = lines[index] ?? ''

  useEffect(() => {
    const t = setTimeout(() => {
      if (count < active.length) {
        setCount((v) => v + 1)
      } else {
        setTimeout(() => {
          setIndex((v) => (v + 1) % lines.length)
          setCount(0)
        }, 700)
      }
    }, speedMs)
    return () => clearTimeout(t)
  }, [active.length, count, lines.length, speedMs])

  return (
    <motion.pre
      className="pretext"
      initial={{ opacity: 0.5 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {active.slice(0, count)}
      <span className="cursor">|</span>
    </motion.pre>
  )
}
