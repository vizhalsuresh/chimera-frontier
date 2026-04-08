import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import type { Profile, ScheduleEntry } from '../types'

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
type Day = (typeof ALL_DAYS)[number]

function todayAbbr(): Day {
  return ALL_DAYS[((new Date().getDay() + 6) % 7)] // Mon=0 offset
}

function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── styles as objects so no Tailwind needed ────────────────────────────────
const C = {
  pri: '#8eff71',
  sec: '#00fbfb',
  err: '#ff7351',
  surf0: '#000000',
  surf1: '#0e0e0e',
  surf2: '#131313',
  surf3: '#191919',
  surf4: '#1f1f1f',
  surf5: '#262626',
  outline: '#484848',
  mute: 'rgba(255,255,255,0.25)',
}

const s = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: '4px 0' },
  mono: { fontFamily: "'Space Grotesk', monospace", letterSpacing: '0.06em' },
  label: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.18em', color: C.mute },
  sectionTitle: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const,
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
  },
  chip: (active: boolean, color = C.pri) => ({
    padding: '4px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, cursor: 'pointer', border: `1px solid ${active ? color : C.outline}`,
    background: active ? `${color}18` : C.surf4, color: active ? color : 'rgba(255,255,255,0.4)',
    borderRadius: 2, transition: 'all 0.15s',
    boxShadow: active ? `0 0 8px ${color}22` : 'none',
  }),
  btn: (variant: 'primary' | 'danger' | 'ghost' = 'primary') => ({
    padding: '6px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: 2,
    border: `1px solid ${variant === 'danger' ? C.err : variant === 'ghost' ? C.outline : C.pri}`,
    background: variant === 'danger' ? `${C.err}18` : variant === 'ghost' ? C.surf4 : `${C.pri}15`,
    color: variant === 'danger' ? C.err : variant === 'ghost' ? 'rgba(255,255,255,0.5)' : C.pri,
    transition: 'all 0.15s',
  }),
  input: {
    background: C.surf4, border: `1px solid ${C.outline}`, color: '#e9f0f4',
    padding: '7px 10px', fontSize: 11, borderRadius: 2, outline: 'none', width: '100%',
    fontFamily: "'Space Grotesk', monospace",
  } as React.CSSProperties,
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countPerDay(schedules: Record<string, ScheduleEntry>): Record<Day, number> {
  const counts = Object.fromEntries(ALL_DAYS.map((d) => [d, 0])) as Record<Day, number>
  for (const sched of Object.values(schedules)) {
    for (const day of sched.days as Day[]) {
      if (day in counts) counts[day]++
    }
  }
  return counts
}

function schedulesForDay(
  schedules: Record<string, ScheduleEntry>,
  day: Day,
): [string, ScheduleEntry][] {
  return Object.entries(schedules)
    .filter(([, s]) => s.days.includes(day))
    .sort((a, b) => a[1].time.localeCompare(b[1].time))
}

// ── Add Modal ──────────────────────────────────────────────────────────────

function AddModal({
  onClose,
  onSave,
  initialDays,
}: {
  onClose: () => void
  onSave: (time: string, action: 'on' | 'off', days: Day[]) => Promise<void>
  initialDays: Day[]
}) {
  const [time, setTime] = useState(nowTime())
  const [action, setAction] = useState<'on' | 'off'>('on')
  const [days, setDays] = useState<Day[]>(initialDays)
  const [busy, setBusy] = useState(false)

  function toggleDay(d: Day) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  async function submit() {
    if (!days.length) return
    setBusy(true)
    try {
      await onSave(time, action, days)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 12 }}
        style={{
          background: C.surf2, border: `1px solid ${C.outline}`, borderRadius: 4,
          padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ ...s.label, color: C.sec }}>New_Schedule_Event</span>
          <button style={{ background: 'none', border: 'none', color: C.mute, cursor: 'pointer', fontSize: 18 }} onClick={onClose}>✕</button>
        </div>

        <div>
          <div style={{ ...s.label, marginBottom: 6 }}>Time</div>
          <input type="time" step="300" value={time} onChange={(e) => setTime(e.target.value)} style={s.input} />
        </div>

        <div>
          <div style={{ ...s.label, marginBottom: 6 }}>Action</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['on', 'off'] as const).map((a) => (
              <button key={a} style={{ ...s.chip(action === a, a === 'on' ? C.pri : C.err), flex: 1, padding: '8px 0' }} onClick={() => setAction(a)}>
                {a === 'on' ? 'TURN ON' : 'TURN OFF'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...s.label, marginBottom: 6 }}>Repeat on days</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {ALL_DAYS.map((d) => (
              <button key={d} style={{ ...s.chip(days.includes(d), C.sec), padding: '6px 2px', fontSize: 9 }} onClick={() => toggleDay(d)}>
                {d.slice(0, 2)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button style={{ ...s.btn('ghost'), flex: 1, padding: '10px 0' }} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.btn('primary'), flex: 1, padding: '10px 0', opacity: busy || !days.length ? 0.6 : 1 }}
            onClick={submit}
            disabled={busy || !days.length}
          >
            {busy ? 'Saving…' : 'Apply_To_Cron'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function SchedulerPage() {
  const [schedules, setSchedules] = useState<Record<string, ScheduleEntry>>({})
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [logLines, setLogLines] = useState<string[]>([])
  const [selectedDay, setSelectedDay] = useState<Day>(todayAbbr())
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [clock, setClock] = useState(nowTime())
  const consoleRef = useRef<HTMLDivElement>(null)

  async function reload() {
    const data = await api.getSchedules()
    setSchedules(data.schedules ?? {})
  }

  async function reloadLogs() {
    try {
      const data = await api.getLogs('cron', 40)
      if (data.ok) setLogLines(data.lines)
    } catch {
      // log api optional
    }
  }

  useEffect(() => {
    reload().catch(() => {})
    api.getProfiles().then((d) => setProfiles(d.profiles ?? [])).catch(() => {})
    reloadLogs()
    const clockTimer = setInterval(() => setClock(nowTime()), 30_000)
    const schedTimer = setInterval(() => reload().catch(() => {}), 30_000)
    const logTimer   = setInterval(() => reloadLogs(), 10_000)
    return () => { clearInterval(clockTimer); clearInterval(schedTimer); clearInterval(logTimer) }
  }, [])

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [logLines])

  const counts = useMemo(() => countPerDay(schedules), [schedules])
  const maxCount = useMemo(() => Math.max(1, ...Object.values(counts)), [counts])
  const dayEntries = useMemo(() => schedulesForDay(schedules, selectedDay), [schedules, selectedDay])

  async function handleAddSave(time: string, action: 'on' | 'off', days: Day[]) {
    await api.addSchedule({ time, action, days })
    await api.syncSchedules()
    await reload()
  }

  async function handleDelete(sid: string) {
    setBusy(true)
    try {
      await api.deleteSchedule(sid)
      await api.syncSchedules()
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function handlePurge() {
    if (!window.confirm('Delete ALL schedules? This cannot be undone.')) return
    setBusy(true)
    try {
      for (const sid of Object.keys(schedules)) {
        await api.deleteSchedule(sid)
      }
      await api.syncSchedules()
      await reload()
    } finally {
      setBusy(false)
    }
  }

  function handlePreset(_profile: Profile) {
    setShowAdd(true)
  }

  function lineColor(line: string): string {
    const l = line.toLowerCase()
    if (l.includes('error') || l.includes('fail')) return C.err
    if (l.includes('warn')) return '#f0a500'
    if (l.includes('success') || l.includes('✓') || l.includes('connected')) return C.pri
    return `${C.pri}60`
  }

  const today = todayAbbr()

  return (
    <>
      <AnimatePresence>
        {showAdd && (
          <AddModal
            onClose={() => setShowAdd(false)}
            onSave={handleAddSave}
            initialDays={[selectedDay]}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={s.page}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `1px solid ${C.surf5}`, paddingBottom: 12 }}>
          <div>
            <div style={{ ...s.label, color: C.pri, marginBottom: 4 }}>System Module</div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
              Scheduler_Core.v2
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              padding: '4px 12px', background: C.surf3, border: `1px solid ${C.outline}`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.pri, boxShadow: `0 0 8px ${C.pri}` }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: C.pri, letterSpacing: '0.12em' }}>
                ACTIVE: {Object.keys(schedules).length} SCHEDULE{Object.keys(schedules).length !== 1 ? 'S' : ''}
              </span>
            </div>
            <button style={s.btn('primary')} onClick={() => setShowAdd(true)}>+ New_Event</button>
            <button style={{ ...s.btn('ghost'), opacity: busy ? 0.5 : 1 }} disabled={busy}
              onClick={async () => { setBusy(true); await api.syncSchedules(); setBusy(false) }}>
              {busy ? 'Syncing…' : 'Sync_Cron'}
            </button>
          </div>
        </div>

        {/* ── Weekly Overview Grid ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {ALL_DAYS.map((day) => {
            const isToday = day === today
            const isSelected = day === selectedDay
            const n = counts[day]
            const barPct = Math.max(8, Math.round((n / maxCount) * 100))
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                style={{
                  background: isSelected ? `${C.pri}10` : C.surf2,
                  border: `1px solid ${isSelected ? C.pri : isToday ? `${C.pri}40` : C.surf5}`,
                  padding: '10px 8px', cursor: 'pointer', textAlign: 'left',
                  borderLeft: isSelected ? `3px solid ${C.pri}` : isToday ? `2px solid ${C.pri}60` : `1px solid ${C.surf5}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ ...s.label, color: isSelected ? C.pri : C.mute }}>{day.toUpperCase()}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: isSelected ? C.pri : isToday ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)', margin: '2px 0 6px' }}>{n}</div>
                <div style={{ height: 3, background: C.surf4, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barPct}%`, background: isSelected ? C.pri : `${C.pri}50`, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Main Content: Timeline + Sidebar ─────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>

          {/* ── Timeline ───────────────────────────────────────────── */}
          <div style={{ background: C.surf2, border: `1px solid ${C.surf5}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ ...s.sectionTitle, color: C.sec, marginBottom: 0 }}>
                <span style={{ fontSize: 14 }}>↔</span> Active_Sequences::{selectedDay}
              </div>
              <button style={{ ...s.btn('danger'), fontSize: 9, padding: '4px 10px', opacity: busy ? 0.5 : 0.7 }}
                onClick={handlePurge} disabled={busy}>
                INIT_PURGE
              </button>
            </div>

            {/* Timeline list */}
            <div style={{ position: 'relative', paddingLeft: 56, borderLeft: `1px solid ${C.surf5}`, paddingTop: 8, paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 20, minHeight: 120 }}>

              {/* Current time marker */}
              <div style={{ position: 'absolute', left: -1, top: '30%', right: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.sec, boxShadow: `0 0 8px ${C.sec}`, marginLeft: -4, flexShrink: 0 }} />
                <div style={{ flex: 1, height: 1, borderTop: `1px dashed ${C.sec}50` }} />
                <span style={{ position: 'absolute', left: -52, fontSize: 9, fontWeight: 700, color: C.sec, ...s.mono }}>{clock}</span>
              </div>

              {dayEntries.length === 0 ? (
                <div style={{ color: C.mute, fontSize: 11, textAlign: 'center', padding: '24px 0', ...s.mono }}>
                  NO_SCHEDULES_FOR_{selectedDay.toUpperCase()}<br />
                  <button style={{ ...s.btn('primary'), marginTop: 12 }} onClick={() => setShowAdd(true)}>+ Add one</button>
                </div>
              ) : (
                dayEntries.map(([sid, sched]) => {
                  const on = sched.action === 'on'
                  return (
                    <motion.div key={sid} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: -52, top: 4, fontSize: 10, fontWeight: 700, ...s.mono, color: on ? C.pri : C.err }}>
                        {sched.time}
                      </span>
                      <div style={{
                        background: C.surf3, padding: 14,
                        borderLeft: `4px solid ${on ? `${C.pri}80` : `${C.err}80`}`,
                        transition: 'border-color 0.2s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, ...s.mono, color: on ? C.pri : C.err }}>
                              {on ? 'TURN_ON' : 'TURN_OFF'}
                            </div>
                            <div style={{ fontSize: 9, color: C.mute, marginTop: 3, ...s.mono }}>
                              DAYS: {sched.days.join(', ')}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                            <span style={{ fontSize: 9, color: C.outline, ...s.mono }}>{sid}</span>
                            <button
                              style={{ ...s.btn('danger'), fontSize: 9, padding: '3px 8px' }}
                              onClick={() => handleDelete(sid)}
                              disabled={busy}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: 9, ...s.mono, color: sched.enabled ? `${C.pri}90` : `${C.err}90` }}>
                          STATUS: {sched.enabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                      </div>
                    </motion.div>
                  )
                })
              )}
            </div>
          </div>

          {/* ── Sidebar ────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Quick Presets */}
            <div style={{ background: C.surf2, border: `1px solid ${C.surf5}`, borderLeft: `2px solid ${C.sec}60`, padding: 16 }}>
              <div style={{ ...s.sectionTitle, color: C.sec }}>
                <span>⚡</span> Quick_Presets
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {profiles.length === 0 ? (
                  <div style={{ fontSize: 10, color: C.mute, ...s.mono }}>No profiles configured</div>
                ) : (
                  profiles.map((p) => (
                    <button
                      key={p.name}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', background: C.surf3, border: `1px solid ${C.surf5}`,
                        cursor: 'pointer', transition: 'all 0.15s', color: 'rgba(255,255,255,0.7)',
                      }}
                      onClick={() => handlePreset(p)}
                    >
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, ...s.mono }}>{p.name}</div>
                        <div style={{ fontSize: 9, color: C.mute, marginTop: 2, ...s.mono }}>
                          {p.temp}°C · {p.mode.toUpperCase()} · {p.fan}
                        </div>
                      </div>
                      <span style={{ color: C.sec, fontSize: 16 }}>+</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Schedule Density */}
            <div style={{ background: C.surf2, border: `1px solid ${C.surf5}`, borderLeft: `2px solid ${C.pri}30`, padding: 16 }}>
              <div style={{ ...s.sectionTitle, color: C.pri }}>
                <span>📊</span> Schedule_Density
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 48, marginBottom: 8 }}>
                {ALL_DAYS.map((d) => {
                  const n = counts[d]
                  const pct = Math.max(8, Math.round((n / maxCount) * 100))
                  return (
                    <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{
                        width: '100%', height: `${pct}%`,
                        background: d === selectedDay ? C.pri : `${C.pri}40`,
                        borderRadius: '2px 2px 0 0', transition: 'all 0.3s',
                      }} />
                      <span style={{ fontSize: 8, color: d === selectedDay ? C.pri : C.mute, ...s.mono }}>{d.slice(0, 1)}</span>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div style={{ background: C.surf1, padding: '8px 10px', border: `1px solid ${C.surf5}` }}>
                  <div style={{ ...s.label, marginBottom: 3 }}>Total</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.pri }}>{Object.keys(schedules).length}</div>
                </div>
                <div style={{ background: C.surf1, padding: '8px 10px', border: `1px solid ${C.surf5}` }}>
                  <div style={{ ...s.label, marginBottom: 3 }}>Today</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.sec }}>{counts[today]}</div>
                </div>
              </div>
            </div>

            {/* Status Console */}
            <div style={{ background: C.surf0, border: `1px solid ${C.surf5}`, padding: 12, position: 'relative', minHeight: 140 }}>
              <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, color: `${C.pri}50`, ...s.mono }}>LIVE_FEED</div>
              <div
                ref={consoleRef}
                style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                {logLines.length === 0 ? (
                  <div style={{ fontSize: 9, color: C.mute, ...s.mono, paddingTop: 20, textAlign: 'center' }}>
                    _no cron events yet…
                  </div>
                ) : (
                  logLines.map((line, i) => (
                    <div key={i} style={{ fontSize: 9, ...s.mono, color: lineColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}
