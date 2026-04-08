export type ACState = {
  power: boolean
  temp: number
  mode: string
  fan: string
  swing_v: boolean
  swing_h: boolean
  swing_angle: number
  eco: boolean
  powerful: boolean
  quiet: boolean
  nanoe: boolean
  iauto: boolean
  online: boolean
  device: string | null
  schedule_count: number
}

export type ScheduleEntry = {
  time: string
  action: 'on' | 'off'
  days: string[]
  enabled: boolean
  created?: string
}

export type TimerStatus = {
  active: boolean
  fires_at?: string
  remaining_s?: number
  steps?: number
}

export type Profile = {
  name: string
  temp: number
  mode: string
  fan: string
  icon?: string
}
