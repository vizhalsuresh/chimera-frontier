import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import type { Profile, ScheduleEntry } from '../types'

// ── Constants ──────────────────────────────────────────────────────────────

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
type Day = (typeof ALL_DAYS)[number]

const C = {
  pri: '#8eff71', sec: '#00fbfb', err: '#ff7351',
  surf0: '#000000', surf1: '#0e0e0e', surf2: '#131313',
  surf3: '#191919', surf4: '#1f1f1f', surf5: '#262626',
  outline: '#484848', mute: 'rgba(255,255,255,0.25)',
}

const mono = { fontFamily: "'Space Grotesk', monospace", letterSpacing: '0.06em' }
const label = { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.18em', color: C.mute }

function chip(active: boolean, color = C.pri): React.CSSProperties {
  return {
    padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2,
    border: `1px solid ${active ? color : C.outline}`,
    background: active ? `${color}18` : C.surf4,
    color: active ? color : 'rgba(255,255,255,0.4)',
    transition: 'all 0.15s',
    boxShadow: active ? `0 0 8px ${color}20` : 'none',
  }
}

function btn(variant: 'primary' | 'danger' | 'ghost' = 'primary'): React.CSSProperties {
  const map = { primary: C.pri, danger: C.err, ghost: C.outline }
  const col = map[variant]
  return {
    padding: '6px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2,
    border: `1px solid ${col}`,
    background: variant === 'ghost' ? C.surf4 : `${col}15`,
    color: variant === 'ghost' ? 'rgba(255,255,255,0.5)' : col,
    transition: 'all 0.15s',
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function todayAbbr(): Day {
  return ALL_DAYS[(new Date().getDay() + 6) % 7]
}

function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function countPerDay(schedules: Record<string, ScheduleEntry>): Record<Day, number> {
  const counts = Object.fromEntries(ALL_DAYS.map((d) => [d, 0])) as Record<Day, number>
  for (const s of Object.values(schedules))
    for (const day of s.days as Day[])
      if (day in counts) counts[day]++
  return counts
}

function forDay(schedules: Record<string, ScheduleEntry>, day: Day): [string, ScheduleEntry][] {
  return Object.entries(schedules)
    .filter(([, s]) => s.days.includes(day))
    .sort((a, b) => a[1].time.localeCompare(b[1].time))
}

function lineColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('fail')) return C.err
  if (l.includes('warn')) return '#f0a500'
  if (l.includes('success') || l.includes('✓') || l.includes('connected')) return C.pri
  return `${C.pri}60`
}

// ── Add Modal ──────────────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void
  onSave: (time: string, action: 'on' | 'off', days: Day[]) => Promise<void>
  initialDays: Day[]
  preset?: Profile  // when opened from a preset, pre-label the modal
}

function AddModal({ onClose, onSave, initialDays, preset }: AddModalProps) {
  const [time, setTime]     = useState(nowTime())
  const [action, setAction] = useState<'on' | 'off'>('on')
  const [days, setDays]     = useState<Day[]>(initialDays)
  const [busy, setBusy]     = useState(false)

  function toggleDay(d: Day) {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])
  }

  async function submit() {
    if (!days.length) return
    setBusy(true)
    try { await onSave(time, action, days); onClose() }
    finally { setBusy(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        style={{
          background: C.surf2, border: `1px solid ${C.outline}`, borderRadius: 4,
          padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ ...label, color: C.sec }}>
            {preset ? `Schedule :: ${preset.name}` : 'New_Schedule_Event'}
          </span>
          <button style={{ background: 'none', border: 'none', color: C.mute, cursor: 'pointer', fontSize: 18 }} onClick={onClose}>✕</button>
        </div>

        {preset && (
          <div style={{ background: C.surf3, border: `1px solid ${C.outline}`, padding: '8px 12px', fontSize: 9, ...mono, color: C.sec }}>
            {preset.temp}°C · {preset.mode.toUpperCase()} · FAN:{preset.fan.toUpperCase()}
            <span style={{ color: C.mute, marginLeft: 8 }}>— settings applied when AC turns on</span>
          </div>
        )}

        <div>
          <div style={{ ...label, marginBottom: 6 }}>Time</div>
          <input type="time" step="300" value={time} onChange={(e) => setTime(e.target.value)}
            style={{ background: C.surf4, border: `1px solid ${C.outline}`, color: '#e9f0f4', padding: '7px 10px', fontSize: 11, borderRadius: 2, outline: 'none', width: '100%', ...mono }} />
        </div>

        <div>
          <div style={{ ...label, marginBottom: 6 }}>Action</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['on', 'off'] as const).map((a) => (
              <button key={a} style={{ ...chip(action === a, a === 'on' ? C.pri : C.err), flex: 1, padding: '8px 0' }} onClick={() => setAction(a)}>
                {a === 'on' ? 'TURN ON' : 'TURN OFF'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...label, marginBottom: 6 }}>Repeat on days</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {ALL_DAYS.map((d) => (
              <button key={d} style={{ ...chip(days.includes(d), C.sec), padding: '6px 2px', fontSize: 9 }} onClick={() => toggleDay(d)}>
                {d.slice(0, 2)}
              </button>
            ))}
          </div>
          {!days.length && <p style={{ fontSize: 9, color: C.err, marginTop: 4, ...mono }}>Select at least one day</p>}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btn('ghost'), flex: 1, padding: '10px 0' }} onClick={onClose}>Cancel</button>
          <button
            style={{ ...btn('primary'), flex: 1, padding: '10px 0', opacity: busy || !days.length ? 0.55 : 1 }}
            onClick={submit} disabled={busy || !days.length}
          >
            {busy ? 'Saving…' : 'Apply_To_Cron'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function SchedulerPage() {
  const [schedules, setSchedules]   = useState<Record<string, ScheduleEntry>>({})
  const [profiles, setProfiles]     = useState<Profile[]>([])
  const [logLines, setLogLines]     = useState<string[]>([])
  const [selectedDay, setSelectedDay] = useState<Day>(todayAbbr())
  const [addPreset, setAddPreset]   = useState<Profile | null>(null)  // null = no modal, Profile = preset modal
  const [showAdd, setShowAdd]       = useState(false)
  const [syncing, setSyncing]       = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [clock, setClock]           = useState(nowTime())
  const consoleRef                  = useRef<HTMLDivElement>(null)

  async function reload() {
    const data = await api.getSchedules()
    setSchedules(data.schedules ?? {})
  }

  async function reloadLogs() {
    try {
      const data = await api.getLogs('cron', 40)
      if (data.ok) setLogLines(data.lines)
    } catch { /* logs are optional */ }
  }

  useEffect(() => {
    reload().catch(() => {})
    api.getProfiles().then((d) => setProfiles(d.profiles ?? [])).catch(() => {})
    reloadLogs()
    const clockT = setInterval(() => setClock(nowTime()), 30_000)
    const schedT = setInterval(() => reload().catch(() => {}), 30_000)
    const logT   = setInterval(() => reloadLogs(), 10_000)
    return () => { clearInterval(clockT); clearInterval(schedT); clearInterval(logT) }
  }, [])

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [logLines])

  const counts    = useMemo(() => countPerDay(schedules), [schedules])
  const maxCount  = useMemo(() => Math.max(1, ...Object.values(counts)), [counts])
  const dayEntries = useMemo(() => forDay(schedules, selectedDay), [schedules, selectedDay])
  const today     = todayAbbr()

  async function handleAddSave(time: string, action: 'on' | 'off', days: Day[]) {
    await api.addSchedule({ time, action, days })
    await api.syncSchedules()
    await reload()
  }

  async function handleSync() {
    setSyncing(true)
    try { await api.syncSchedules(); await reload() }
    finally { setSyncing(false) }
  }

  async function handleDelete(sid: string) {
    if (!window.confirm(`Delete schedule "${sid}"?`)) return
    setDeletingId(sid)
    try {
      await api.deleteSchedule(sid)
      await api.syncSchedules()
      await reload()
    } finally { setDeletingId(null) }
  }

  async function handleToggle(sid: string, current: boolean) {
    setTogglingId(sid)
    try {
      await api.toggleSchedule(sid, !current)
      await reload()
    } finally { setTogglingId(null) }
  }

  async function handlePurgeDay() {
    const dayScheds = forDay(schedules, selectedDay)
    if (!dayScheds.length) return
    if (!window.confirm(`Delete all ${dayScheds.length} schedule(s) for ${selectedDay}?`)) return
    for (const [sid] of dayScheds) await api.deleteSchedule(sid)
    await api.syncSchedules()
    await reload()
  }

  return (
    <>
      <AnimatePresence>
        {(showAdd || addPreset) && (
          <AddModal
            key="add-modal"
            onClose={() => { setShowAdd(false); setAddPreset(null) }}
            onSave={handleAddSave}
            initialDays={[selectedDay]}
            preset={addPreset ?? undefined}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `1px solid ${C.surf5}`, paddingBottom: 12 }}>
          <div>
            <div style={{ ...label, color: C.pri, marginBottom: 4 }}>System Module</div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>Scheduler_Core</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ padding: '4px 12px', background: C.surf3, border: `1px solid ${C.outline}`, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.pri, boxShadow: `0 0 6px ${C.pri}` }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: C.pri, letterSpacing: '0.12em' }}>
                {Object.keys(schedules).length} SCHEDULE{Object.keys(schedules).length !== 1 ? 'S' : ''}
              </span>
            </div>
            <button style={btn('primary')} onClick={() => setShowAdd(true)}>+ New_Event</button>
            <button style={{ ...btn('ghost'), opacity: syncing ? 0.5 : 1 }} disabled={syncing} onClick={handleSync}>
              {syncing ? 'Syncing…' : 'Sync_Cron'}
            </button>
          </div>
        </div>

        {/* ── Weekly Day Grid ────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {ALL_DAYS.map((day) => {
            const isToday    = day === today
            const isSelected = day === selectedDay
            const n          = counts[day]
            const barPct     = Math.max(6, Math.round((n / maxCount) * 100))
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                style={{
                  background: isSelected ? `${C.pri}10` : C.surf2,
                  borderLeft: `${isSelected ? 3 : 1}px solid ${isSelected ? C.pri : isToday ? `${C.pri}40` : C.surf5}`,
                  borderTop: `1px solid ${isSelected ? C.pri : C.surf5}`,
                  borderRight: `1px solid ${isSelected ? C.pri : C.surf5}`,
                  borderBottom: `1px solid ${isSelected ? C.pri : C.surf5}`,
                  padding: '10px 8px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                <div style={{ ...label, color: isSelected ? C.pri : C.mute }}>{day.toUpperCase()}</div>
                <div style={{ fontSize: 20, fontWeight: 700, margin: '2px 0 6px', color: isSelected ? C.pri : isToday ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)' }}>{n}</div>
                <div style={{ height: 3, background: C.surf4, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barPct}%`, background: isSelected ? C.pri : `${C.pri}40`, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Timeline + Sidebar ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>

          {/* Timeline */}
          <div style={{ background: C.surf2, border: `1px solid ${C.surf5}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.sec }}>
                Sequences :: {selectedDay}
              </span>
              <button
                style={{ ...btn('danger'), fontSize: 9, padding: '4px 10px', opacity: dayEntries.length ? 0.75 : 0.3 }}
                onClick={handlePurgeDay}
                disabled={!dayEntries.length}
                title={`Delete all schedules for ${selectedDay}`}
              >
                Clear_{selectedDay}
              </button>
            </div>

            {/* Timeline rail */}
            <div style={{ position: 'relative', paddingLeft: 56, borderLeft: `1px solid ${C.surf5}`, paddingTop: 8, paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 100 }}>
              {/* Now marker */}
              <div style={{ position: 'absolute', left: -1, top: '28%', right: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.sec, boxShadow: `0 0 8px ${C.sec}`, marginLeft: -4, flexShrink: 0 }} />
                <div style={{ flex: 1, height: 1, borderTop: `1px dashed ${C.sec}50` }} />
                <span style={{ position: 'absolute', left: -52, fontSize: 9, fontWeight: 700, color: C.sec, ...mono }}>{clock}</span>
              </div>

              {dayEntries.length === 0 ? (
                <div style={{ color: C.mute, fontSize: 11, textAlign: 'center', padding: '28px 0', ...mono }}>
                  NO_SCHEDULES_FOR_{selectedDay.toUpperCase()}
                  <br />
                  <button style={{ ...btn('primary'), marginTop: 12 }} onClick={() => setShowAdd(true)}>+ Add one</button>
                </div>
              ) : (
                dayEntries.map(([sid, sched]) => {
                  const on      = sched.action === 'on'
                  const deleting = deletingId === sid
                  const toggling = togglingId === sid
                  const color   = on ? C.pri : C.err
                  return (
                    <motion.div key={sid} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: -52, top: 4, fontSize: 10, fontWeight: 700, ...mono, color }}>
                        {sched.time}
                      </span>
                      <div style={{
                        background: sched.enabled ? C.surf3 : C.surf1,
                        padding: 14, borderLeft: `4px solid ${sched.enabled ? `${color}90` : C.outline}`,
                        opacity: sched.enabled ? 1 : 0.55, transition: 'all 0.2s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, ...mono, color }}>{on ? 'TURN_ON' : 'TURN_OFF'}</div>
                            <div style={{ fontSize: 9, color: C.mute, marginTop: 3, ...mono }}>DAYS: {sched.days.join(', ')}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                            <span style={{ fontSize: 8, color: C.outline, ...mono }}>{sid}</span>
                            <div style={{ display: 'flex', gap: 5 }}>
                              {/* Enable / Disable toggle */}
                              <button
                                style={{ ...btn(sched.enabled ? 'ghost' : 'primary'), fontSize: 9, padding: '3px 8px', opacity: toggling ? 0.5 : 1 }}
                                onClick={() => handleToggle(sid, sched.enabled)}
                                disabled={toggling}
                              >
                                {toggling ? '…' : sched.enabled ? 'Disable' : 'Enable'}
                              </button>
                              {/* Delete */}
                              <button
                                style={{ ...btn('danger'), fontSize: 9, padding: '3px 8px', opacity: deleting ? 0.5 : 1 }}
                                onClick={() => handleDelete(sid)}
                                disabled={deleting}
                              >
                                {deleting ? '…' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: 9, ...mono, color: sched.enabled ? `${C.pri}90` : `${C.err}80` }}>
                          STATUS: {sched.enabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                      </div>
                    </motion.div>
                  )
                })
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Quick Presets — clicking a preset opens the modal with preset context */}
            <div style={{ background: C.surf2, border: `1px solid ${C.surf5}`, borderLeft: `2px solid ${C.sec}60`, padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.sec, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                ⚡ Quick_Presets
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {profiles.length === 0
                  ? <div style={{ fontSize: 10, color: C.mute, ...mono }}>No profiles — add them via Dashboard</div>
                  : profiles.map((p) => (
                    <button
                      key={p.name}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: C.surf3, border: `1px solid ${C.surf5}`, cursor: 'pointer', transition: 'all 0.15s', color: 'rgba(255,255,255,0.7)' }}
                      onClick={() => setAddPreset(p)}
                    >
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, ...mono }}>{p.name}</div>
                        <div style={{ fontSize: 9, color: C.mute, marginTop: 2, ...mono }}>{p.temp}°C · {p.mode.toUpperCase()} · {p.fan}</div>
                      </div>
                      <span style={{ color: C.sec, fontSize: 16 }}>+</span>
                    </button>
                  ))
                }
              </div>
            </div>

            {/* Schedule Density */}
            <div style={{ background: C.surf2, border: `1px solid ${C.surf5}`, borderLeft: `2px solid ${C.pri}30`, padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.pri, marginBottom: 12 }}>
                Schedule_Density
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 48, marginBottom: 8 }}>
                {ALL_DAYS.map((d) => {
                  const n   = counts[d]
                  const pct = Math.max(6, Math.round((n / maxCount) * 100))
                  return (
                    <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{ width: '100%', height: `${pct}%`, background: d === selectedDay ? C.pri : `${C.pri}40`, borderRadius: '2px 2px 0 0', transition: 'all 0.3s' }} />
                      <span style={{ fontSize: 8, color: d === selectedDay ? C.pri : C.mute, ...mono }}>{d[0]}</span>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: C.surf1, padding: '8px 10px', border: `1px solid ${C.surf5}` }}>
                  <div style={{ ...label, marginBottom: 3 }}>Total</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.pri }}>{Object.keys(schedules).length}</div>
                </div>
                <div style={{ background: C.surf1, padding: '8px 10px', border: `1px solid ${C.surf5}` }}>
                  <div style={{ ...label, marginBottom: 3 }}>Today</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.sec }}>{counts[today]}</div>
                </div>
              </div>
            </div>

            {/* Status Console */}
            <div style={{ background: C.surf0, border: `1px solid ${C.surf5}`, padding: 12, position: 'relative' }}>
              <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, color: `${C.pri}50`, ...mono }}>CRON_LOG</div>
              <div ref={consoleRef} style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {logLines.length === 0
                  ? <div style={{ fontSize: 9, color: C.mute, ...mono, paddingTop: 20, textAlign: 'center' }}>_no cron events yet</div>
                  : logLines.map((line, i) => (
                    <div key={i} style={{ fontSize: 9, ...mono, color: lineColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {line}
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}
