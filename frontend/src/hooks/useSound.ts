import { useCallback, useSyncExternalStore } from 'react'
import { soundEngine } from '../lib/soundEngine'

// ── Simple external store for muted state ────────────────────────────────────

const listeners = new Set<() => void>()
let _muted = soundEngine.muted

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function getSnapshot() { return _muted }

function setMuted(v: boolean) {
  _muted = v
  soundEngine.muted = v
  listeners.forEach((cb) => cb())
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSound() {
  const muted = useSyncExternalStore(subscribe, getSnapshot)

  return {
    hover:      useCallback(() => soundEngine.hover(),      []),
    click:      useCallback(() => soundEngine.click(),      []),
    toggle:     useCallback(() => soundEngine.toggle(),     []),
    success:    useCallback(() => soundEngine.success(),    []),
    error:      useCallback(() => soundEngine.error(),      []),
    transition: useCallback(() => soundEngine.transition(), []),
    tick:       useCallback(() => soundEngine.tick(),       []),
    scanline:   useCallback(() => soundEngine.scanline(),   []),
    muted,
    toggleMute: useCallback(() => setMuted(!soundEngine.muted), []),
    setVolume:  useCallback((v: number) => { soundEngine.volume = v }, []),
  }
}
