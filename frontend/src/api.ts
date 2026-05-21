import { supabase } from './supabaseClient'
import type { ACState, Profile, ScheduleEntry, TimerStatus } from './types'

export const api = {
  // ── AC state & control ─────────────────────────────────────────────────
  getState: async () => {
    const { data, error } = await supabase
      .from('ac_state')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
    
    if (error) throw error
    return data as ACState
  },

  togglePower: async (power: boolean) => {
    const { data, error } = await supabase.functions.invoke('miraie-worker', {
      body: { action: power ? 'on' : 'off' }
    })
    if (error) throw error
    return data
  },

  syncState: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    
    const { data, error } = await supabase.functions.invoke('miraie-worker', {
      body: { action: 'status_request', user_id: user.id }
    })
    if (error) throw error
    return data
  },

  control: async (payload: Partial<ACState>) => {
    // For general control, we might still want to use an Edge Function 
    // to ensure the device actually receives the command.
    // However, the instructions specifically mention 'Turn On/Off' for Edge Function.
    // For other properties, we might update the table and let a worker pick it up,
    // or use another function. 
    // Given the instruction "Update 'Turn On/Off' buttons to call the 'miraie-worker' Edge Function",
    // I will implement a generic control that might use the function or table.
    
    // If it's just a power toggle, use the function as requested.
    if (payload.power !== undefined) {
      const { data, error } = await supabase.functions.invoke('miraie-worker', {
        body: { action: payload.power ? 'on' : 'off' }
      })
      if (error) throw error
      return data as ACState
    }

    // For other updates, update the state table
    const { data, error } = await supabase
      .from('ac_state')
      .insert([payload])
      .select()
      .single()
    
    if (error) throw error
    return data as ACState
  },

  // ── Schedules ──────────────────────────────────────────────────────────
  getSchedules: async () => {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
    
    if (error) throw error
    
    // Convert array to Record<string, ScheduleEntry> to maintain compatibility
    const schedules: Record<string, ScheduleEntry> = {}
    data.forEach((s: any) => {
      schedules[s.id] = s
    })
    return { schedules }
  },

  addSchedule: async (payload: { time: string; action: 'on' | 'off'; days: string[] }) => {
    const { data, error } = await supabase
      .from('schedules')
      .insert([payload])
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  toggleSchedule: async (sid: string, enabled: boolean) => {
    const { data, error } = await supabase
      .from('schedules')
      .update({ enabled })
      .eq('id', sid)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  deleteSchedule: async (sid: string) => {
    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', sid)
    
    if (error) throw error
  },

  clearAllSchedules: async () => {
    const { error } = await supabase
      .from('schedules')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all
    
    if (error) throw error
  },

  syncSchedules: async () => {
    // This probably needs an Edge Function to sync with the physical device
    const { data, error } = await supabase.functions.invoke('miraie-worker', {
      body: { action: 'sync_schedules' }
    })
    if (error) throw error
    return data
  },

  // ── Scheduler master toggle ────────────────────────────────────────────
  getSchedulerStatus: async () => {
    const { data, error } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'scheduler_enabled')
      .single()
    
    if (error && error.code !== 'PGRST116') throw error
    return { enabled: data?.value === 'true', cron_jobs: 0 }
  },

  setSchedulerEnabled: async (enabled: boolean) => {
    const { error } = await supabase
      .from('config')
      .upsert({ key: 'scheduler_enabled', value: String(enabled) })
    
    if (error) throw error
    return { ok: true, enabled, cron_jobs: 0 }
  },

  // ── Schedule profiles ──────────────────────────────────────────────────
  getScheduleProfiles: async () => {
    const { data, error } = await supabase
      .from('schedule_profiles')
      .select('*')
    
    if (error) throw error
    
    const profiles: Record<string, any> = {}
    data.forEach((p: any) => {
      profiles[p.name] = { schedules: p.schedules, saved: p.updated_at }
    })
    return { profiles }
  },

  saveScheduleProfile: async (name: string) => {
    // Fetch current schedules first
    const { data: schedules } = await supabase.from('schedules').select('*')
    
    const { error } = await supabase
      .from('schedule_profiles')
      .upsert({ name, schedules })
    
    if (error) throw error
  },

  loadScheduleProfile: async (name: string) => {
    const { data: profile, error: pError } = await supabase
      .from('schedule_profiles')
      .select('schedules')
      .eq('name', name)
      .single()
    
    if (pError) throw pError

    // Clear and insert new schedules
    await supabase.from('schedules').delete().neq('id', '0')
    const { error } = await supabase.from('schedules').insert(profile.schedules)
    
    if (error) throw error
  },

  deleteScheduleProfile: async (name: string) => {
    const { error } = await supabase
      .from('schedule_profiles')
      .delete()
      .eq('name', name)
    
    if (error) throw error
  },

  // ── Timers ─────────────────────────────────────────────────────────────
  getTimers: async () => {
    const { data, error } = await supabase
      .from('timers')
      .select('*')
    
    if (error) throw error
    
    const timers: Record<string, TimerStatus> = {}
    data.forEach((t: any) => {
      timers[t.timer_id] = t
    })
    return timers
  },

  setTimer: async (payload: { timer_id: 'on' | 'off' | 'sleep'; hours: number; minutes: number }) => {
    const { data, error } = await supabase.functions.invoke('miraie-worker', {
      body: { action: 'set_timer', ...payload }
    })
    if (error) throw error
    return data
  },

  cancelTimer: async (timerId: 'on' | 'off' | 'sleep') => {
    const { data, error } = await supabase.functions.invoke('miraie-worker', {
      body: { action: 'cancel_timer', timer_id: timerId }
    })
    if (error) throw error
    return data
  },

  // ── Profiles ───────────────────────────────────────────────────────────
  getProfiles: async () => {
    const { data, error } = await supabase
      .from('ac_profiles')
      .select('*')
    
    if (error) throw error
    return { profiles: data as Profile[] }
  },

  saveProfile: async (payload: Profile) => {
    const { error } = await supabase
      .from('ac_profiles')
      .upsert(payload)
    
    if (error) throw error
  },

  deleteProfile: async (name: string) => {
    const { error } = await supabase
      .from('ac_profiles')
      .delete()
      .eq('name', name)
    
    if (error) throw error
  },

  // ── Logs ───────────────────────────────────────────────────────────────
  getLogs: async (file: 'cron' | 'daemon' | 'web' = 'cron', n = 40) => {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('source', file)
      .order('created_at', { ascending: false })
      .limit(n)
    
    if (error) throw error
    return { ok: true, lines: data.map((l: any) => l.message), total: data.length }
  },
}
