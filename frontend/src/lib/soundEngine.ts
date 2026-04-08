/**
 * Cyberpunk Sound Engine — Web Audio API synthesizer.
 * All sounds are generated programmatically; no audio files required.
 * Gracefully no-ops if AudioContext is unavailable or blocked.
 */

class SoundEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private _muted = false
  private _volume = 0.35

  // ── AudioContext lifecycle ─────────────────────────────────────────────────

  private getCtx(): AudioContext | null {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext()
        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.value = this._muted ? 0 : this._volume
        this.masterGain.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
      return this.ctx
    } catch {
      return null
    }
  }

  private out(): AudioNode | null {
    return this.masterGain
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  get muted() { return this._muted }
  set muted(v: boolean) {
    this._muted = v
    if (this.masterGain) this.masterGain.gain.value = v ? 0 : this._volume
  }

  get volume() { return this._volume }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v))
    if (this.masterGain && !this._muted) this.masterGain.gain.value = this._volume
  }

  // ── Sounds ─────────────────────────────────────────────────────────────────

  /** Short high-pitch blip — button hover */
  hover() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = ctx.currentTime

    osc.type = 'sine'
    osc.frequency.setValueAtTime(1900, t)
    osc.frequency.exponentialRampToValueAtTime(2300, t + 0.04)
    gain.gain.setValueAtTime(0.055, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)

    osc.connect(gain)
    gain.connect(dest)
    osc.start(t)
    osc.stop(t + 0.06)
  }

  /** Noise burst + tone down-sweep — button click */
  click() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const t = ctx.currentTime

    // Filtered noise burst
    const bufSize = Math.floor(ctx.sampleRate * 0.07)
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2800
    filter.Q.value = 0.6
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.14, t)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(dest)
    noise.start(t)
    noise.stop(t + 0.07)

    // Tone down-sweep
    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(420, t)
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.065)
    oscGain.gain.setValueAtTime(0.07, t)
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    osc.connect(oscGain)
    oscGain.connect(dest)
    osc.start(t)
    osc.stop(t + 0.07)
  }

  /** Mechanical switch — toggle button */
  toggle() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(200, t)
    osc.frequency.setValueAtTime(360, t + 0.025)
    osc.frequency.setValueAtTime(140, t + 0.055)
    gain.gain.setValueAtTime(0.09, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09)

    osc.connect(gain)
    gain.connect(dest)
    osc.start(t)
    osc.stop(t + 0.09)
  }

  /** 3-note ascending arpeggio — success / confirm */
  success() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const notes = [523.25, 659.25, 783.99] // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.1

      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.11, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19)

      osc.connect(gain)
      gain.connect(dest)
      osc.start(t)
      osc.stop(t + 0.2)
    })
  }

  /** Sawtooth descending buzz — error */
  error() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(240, t)
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.22)
    gain.gain.setValueAtTime(0.11, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24)

    osc.connect(gain)
    gain.connect(dest)
    osc.start(t)
    osc.stop(t + 0.24)
  }

  /** Bass thud + noise burst — page transition */
  transition() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const t = ctx.currentTime

    // Bass impact
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(65, t)
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.16)
    gain.gain.setValueAtTime(0.18, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    osc.connect(gain)
    gain.connect(dest)
    osc.start(t)
    osc.stop(t + 0.18)

    // Noise burst
    const bufSize = Math.floor(ctx.sampleRate * 0.055)
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.08, t)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    noise.connect(noiseGain)
    noiseGain.connect(dest)
    noise.start(t)
    noise.stop(t + 0.07)
  }

  /** Very short soft tick — sequential grid activation */
  tick() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.value = 1050
    gain.gain.setValueAtTime(0.04, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.024)

    osc.connect(gain)
    gain.connect(dest)
    osc.start(t)
    osc.stop(t + 0.024)
  }

  /** Soft low-pass noise whoosh — card scanline reveal */
  scanline() {
    const ctx = this.getCtx()
    const dest = this.out()
    if (!ctx || !dest) return

    const t = ctx.currentTime
    const bufSize = Math.floor(ctx.sampleRate * 0.22)
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)

    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 700

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.038, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(dest)
    noise.start(t)
    noise.stop(t + 0.25)
  }
}

export const soundEngine = new SoundEngine()
