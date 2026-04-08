import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import { AnimatedText } from '../components/AnimatedText'
import { CyberButton } from '../components/CyberButton'
import { CyberCard } from '../components/CyberCard'
import { staggerCards, cardReveal } from '../lib/animationVariants'
import type { ACState, TimerStatus } from '../types'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
  if (s <= 0) return 'idle'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), 3500)
    return () => clearTimeout(t)
  }, [])
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 999,
        background: '#1f1f1f', border: '1px solid #ff7351',
        color: '#ff7351', padding: '8px 16px', fontSize: 11, borderRadius: 2,
        fontFamily: 'Space Grotesk, monospace', letterSpacing: '0.05em',
        boxShadow: '0 0 16px rgba(255,115,81,0.25)',
      }}
    >
      ✕ {msg}
    </motion.div>
  )
}

// ── Defaults ───────────────────────────────────────────────────────────────

const defaults: ACState = {
  power: false, temp: 22, mode: 'cool', fan: 'auto',
  swing_v: true, swing_h: false, swing_angle: 3,
  eco: false, powerful: false, quiet: false, nanoe: false, iauto: false,
  online: false, device: null, schedule_count: 0,
}

// ── Component ──────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [state, setState]               = useState<ACState>(defaults)
  const [timers, setTimers]             = useState<Record<string, TimerStatus>>({})
  const [loading, setLoading]           = useState(false)
  const [timerLoading, setTimerLoading] = useState(false)
  const [timerMinutes, setTimerMinutes] = useState(30)
  const [error, setError]               = useState<string | null>(null)

  function showError(msg: string) { setError(msg) }

  useEffect(() => {
    api.getState().then(setState).catch(() => {})
    api.getTimers().then(setTimers).catch(() => {})
    const s = setInterval(() => api.getState().then(setState).catch(() => {}), 15_000)
    const t = setInterval(() => api.getTimers().then(setTimers).catch(() => {}), 5_000)
    return () => { clearInterval(s); clearInterval(t) }
  }, [])

  async function send(next: Partial<ACState>) {
    setLoading(true)
    try {
      const data = await api.control({ ...state, ...next })
      setState(data)
    } catch (e) {
      showError(`Control failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function setTimer(timerId: 'on' | 'off' | 'sleep') {
    const hours   = Math.floor(timerMinutes / 60)
    const minutes = timerMinutes % 60
    setTimerLoading(true)
    try {
      await api.setTimer({ timer_id: timerId, hours, minutes })
      setTimers(await api.getTimers())
    } catch (e) {
      showError(`Timer failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setTimerLoading(false)
    }
  }

  async function cancelTimer(id: 'on' | 'off' | 'sleep') {
    setTimerLoading(true)
    try {
      await api.cancelTimer(id)
      setTimers(await api.getTimers())
    } catch (e) {
      showError(`Cancel failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setTimerLoading(false)
    }
  }

  return (
    <>
      <AnimatePresence>
        {error && <Toast key={error} msg={error} onDone={() => setError(null)} />}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="page"
      >
        {/* ── Top row ───────────────────────────────────────────────── */}
        <div className="row">
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 4 }}>
              Miraie_AC :: Dashboard
            </div>
            <h1 className="pageTitle" style={{ margin: 0 }}>Command_Core</h1>
          </div>
          <CyberButton
            className={state.power ? 'dangerBtn' : 'primaryBtn'}
            soundType="toggle"
            onClick={() => send({ power: !state.power })}
            disabled={loading}
            style={{ fontWeight: 700, letterSpacing: '0.1em' }}
          >
            {state.power ? 'TURN OFF' : 'TURN ON'}
          </CyberButton>
        </div>

        {/* ── Status bar ────────────────────────────────────────────── */}
        <div className="statusBar">
          <span className={state.online ? 'dot on' : 'dot off'} />
          <span>{state.online ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE'}</span>
          {state.device && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>· {state.device}</span>}
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>· {state.schedule_count} schedule(s)</span>
        </div>

        {/* ── Cards grid ────────────────────────────────────────────── */}
        <motion.div
          className="cards"
          initial="hidden"
          animate="show"
          variants={staggerCards}
        >
          {/* ── Temperature & Mode ────────────────────────────────── */}
          <CyberCard variants={cardReveal}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Temperature</p>
            <div className="row" style={{ marginBottom: 12 }}>
              <CyberButton
                soundType="click"
                onClick={() => send({ temp: Math.max(16, state.temp - 1) })}
                disabled={loading}
                style={{ fontSize: 18, fontWeight: 700, width: 36, height: 36 }}
              >
                −
              </CyberButton>
              <strong style={{ fontSize: 32, fontWeight: 900, color: state.power ? '#8eff71' : 'rgba(255,255,255,0.4)', letterSpacing: '-0.02em' }}>
                {state.temp}<span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>°C</span>
              </strong>
              <CyberButton
                soundType="click"
                onClick={() => send({ temp: Math.min(30, state.temp + 1) })}
                disabled={loading}
                style={{ fontSize: 18, fontWeight: 700, width: 36, height: 36 }}
              >
                +
              </CyberButton>
            </div>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 6 }}>Mode</div>
            <div className="chipRow">
              {(['cool', 'dry', 'fan', 'auto'] as const).map((mode) => (
                <CyberButton
                  key={mode}
                  soundType="toggle"
                  className={state.mode === mode ? 'activeBtn' : ''}
                  onClick={() => send({ mode })}
                  disabled={loading}
                >
                  {mode.toUpperCase()}
                </CyberButton>
              ))}
            </div>
          </CyberCard>

          {/* ── Fan & Features ────────────────────────────────────── */}
          <CyberCard variants={cardReveal}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Fan Speed</p>
            <div className="chipRow" style={{ marginBottom: 12 }}>
              {(['auto', 'low', 'medium', 'high'] as const).map((fan) => (
                <CyberButton
                  key={fan}
                  soundType="toggle"
                  className={state.fan === fan ? 'activeBtn' : ''}
                  onClick={() => send({ fan })}
                  disabled={loading}
                >
                  {fan}
                </CyberButton>
              ))}
            </div>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 6 }}>Features</p>
            <div className="chipRow">
              <CyberButton
                soundType="toggle"
                className={state.eco ? 'activeBtn' : ''}
                onClick={() => send({ eco: !state.eco, ...(state.eco ? {} : { powerful: false }) })}
                disabled={loading}
              >
                ECO
              </CyberButton>
              <CyberButton
                soundType="toggle"
                className={state.powerful ? 'activeBtn' : ''}
                onClick={() => send({ powerful: !state.powerful, ...(state.powerful ? {} : { eco: false }) })}
                disabled={loading}
              >
                TURBO
              </CyberButton>
            </div>
          </CyberCard>

          {/* ── Airflow / Swing ───────────────────────────────────── */}
          <CyberCard variants={cardReveal}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Airflow</p>

            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 6 }}>
              V·Swing Position
            </div>
            <div className="chipRow" style={{ marginBottom: 10 }}>
              <CyberButton
                soundType="toggle"
                className={state.swing_v ? 'activeBtn' : ''}
                onClick={() => send({ swing_v: true })}
                disabled={loading}
                title="Vertical auto-sweep"
              >
                AUTO
              </CyberButton>
              {([1, 2, 3, 4, 5] as const).map((angle) => (
                <CyberButton
                  key={angle}
                  soundType="toggle"
                  className={!state.swing_v && state.swing_angle === angle ? 'activeBtn' : ''}
                  onClick={() => send({ swing_v: false, swing_angle: angle })}
                  disabled={loading}
                >
                  {angle}
                </CyberButton>
              ))}
            </div>

            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 6 }}>
              H·Swing
            </div>
            <div className="chipRow">
              <CyberButton
                soundType="toggle"
                className={state.swing_h ? 'activeBtn' : ''}
                onClick={() => send({ swing_h: !state.swing_h })}
                disabled={loading}
                title="Horizontal auto-sweep"
              >
                {state.swing_h ? 'AUTO' : 'OFF'}
              </CyberButton>
            </div>
          </CyberCard>

          {/* ── Timers ────────────────────────────────────────────── */}
          <CyberCard variants={cardReveal}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Timers</p>
            <div className="row" style={{ marginBottom: 10 }}>
              <input
                type="number"
                min={1}
                max={600}
                value={timerMinutes}
                onChange={(e) => setTimerMinutes(Number(e.target.value) || 30)}
                style={{ width: 64 }}
              />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>minutes</span>
            </div>

            <div className="chipRow" style={{ marginBottom: 8 }}>
              <CyberButton soundType="click" onClick={() => setTimer('on')}    disabled={timerLoading}>ON timer</CyberButton>
              <CyberButton soundType="click" onClick={() => setTimer('off')}   disabled={timerLoading}>OFF timer</CyberButton>
              <CyberButton soundType="click" onClick={() => setTimer('sleep')} disabled={timerLoading}>SLEEP</CyberButton>
            </div>

            {(['on', 'off', 'sleep'] as const).map((id) => {
              const t = timers[id]
              const active = t?.active ?? false
              return (
                <div key={id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 0', borderBottom: '1px solid #1d2b34',
                }}>
                  <span style={{ fontSize: 10, color: active ? '#8eff71' : 'rgba(255,255,255,0.25)', letterSpacing: '0.08em' }}>
                    {id.toUpperCase()}
                    {active && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: '#00fbfb' }}>
                        {id === 'sleep' ? `step ${t.steps ?? 0}` : formatSeconds(t.remaining_s ?? 0)}
                      </span>
                    )}
                  </span>
                  {active && (
                    <CyberButton
                      soundType="click"
                      onClick={() => cancelTimer(id)}
                      disabled={timerLoading}
                      style={{ fontSize: 9, padding: '2px 8px', borderColor: 'rgba(255,115,81,0.4)', color: '#ff7351' }}
                    >
                      Cancel
                    </CyberButton>
                  )}
                </div>
              )
            })}
          </CyberCard>
        </motion.div>

        {/* ── Terminal status strip ──────────────────────────────────── */}
        <motion.div whileHover={{ scale: 1.005 }} className="card terminalCard">
          <AnimatedText
            lines={[
              `SYS_BOOT :: REACT_FRONTEND v2`,
              `POWER=${state.power ? 'ON' : 'OFF'} · TEMP=${state.temp}°C · MODE=${state.mode.toUpperCase()} · FAN=${state.fan.toUpperCase()}`,
              `SWING_V=${state.swing_v ? 'AUTO' : `FIXED_${state.swing_angle}`} · SWING_H=${state.swing_h ? 'AUTO' : 'OFF'}`,
              `ECO=${state.eco} · TURBO=${state.powerful}`,
              `SCHEDULES_ACTIVE=${state.schedule_count} · DEVICE=${state.device ?? 'NONE'}`,
            ]}
          />
        </motion.div>
      </motion.div>
    </>
  )
}
