import type { ACState, Profile, ScheduleEntry, TimerStatus } from './types'

const TOKEN_KEY = 'miraie_api_token'

function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) headers['x-api-token'] = token
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    const next = window.prompt('Enter MIRAIE_API_TOKEN')
    if (!next) throw new Error('HTTP_401')
    setToken(next.trim())
    return request<T>(url, init)
  }
  if (!res.ok) throw new Error(`HTTP_${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  // ── AC state & control ─────────────────────────────────────────────────
  getState: () => request<ACState>('/api/state'),
  control: (payload: Partial<ACState>) =>
    request<ACState>('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  // ── Schedules ──────────────────────────────────────────────────────────
  getSchedules: () =>
    request<{ schedules: Record<string, ScheduleEntry> }>('/api/schedules'),
  addSchedule: (payload: { time: string; action: 'on' | 'off'; days: string[] }) =>
    request('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  toggleSchedule: (sid: string, enabled: boolean) =>
    request(`/api/schedules/${encodeURIComponent(sid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  deleteSchedule: (sid: string) =>
    request(`/api/schedules/${encodeURIComponent(sid)}`, { method: 'DELETE' }),
  syncSchedules: () =>
    request('/api/schedules/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),

  // ── Timers ─────────────────────────────────────────────────────────────
  getTimers: () => request<Record<string, TimerStatus>>('/api/timer'),
  setTimer: (payload: { timer_id: 'on' | 'off' | 'sleep'; hours: number; minutes: number }) =>
    request('/api/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  cancelTimer: (timerId: 'on' | 'off' | 'sleep') =>
    request(`/api/timer/${encodeURIComponent(timerId)}`, { method: 'DELETE' }),

  // ── Profiles ───────────────────────────────────────────────────────────
  getProfiles: () => request<{ profiles: Profile[] }>('/api/profiles'),
  saveProfile: (payload: Profile) =>
    request('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteProfile: (name: string) =>
    request(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // ── Logs ───────────────────────────────────────────────────────────────
  getLogs: (file: 'cron' | 'daemon' | 'web' = 'cron', n = 40) =>
    request<{ ok: boolean; lines: string[]; total?: number }>(`/api/logs?file=${file}&n=${n}`),
}
