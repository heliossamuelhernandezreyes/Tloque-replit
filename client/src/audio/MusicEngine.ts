import { cachedObjectUrl } from "./AudioResourceCache"

export type MusicState = "idle" | "loading" | "playing" | "paused" | "crossfading" | "blocked" | "error"

export interface MusicCue {
  id: number
  title: string
  artist?: string
  sourceType?: "stream" | "procedural" | "soundfont" | "score" | "sfx"
  url?: string
  recipe?: unknown
  packUrl?: string
  packSha256?: string
  packBytes?: number | null
  instrumentProgram?: number | null
  loop: boolean
  volume: number
  crossfadeSeconds: number
}

type Listener = (state: MusicState, cue: MusicCue | null) => void

export class MusicEngine {
  private readonly decks: [HTMLAudioElement, HTMLAudioElement]
  private active = -1
  private cue: MusicCue | null = null
  private state: MusicState = "idle"
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1
  private token = 0
  private raf = 0
  private gainRaf = 0
  private readonly objectUrls: [string | null, string | null] = [null, null]

  constructor(private readonly listener: Listener) {
    const create = () => {
      const audio = new Audio()
      audio.preload = "auto"
      audio.crossOrigin = "anonymous"
      audio.setAttribute("playsinline", "")
      audio.addEventListener("error", () => this.setState("error"))
      return audio
    }
    this.decks = [create(), create()]
  }

  setMasterVolume(value: number) {
    this.master = Math.max(0, Math.min(1, value))
    this.applyActiveVolume()
  }

  setDucked(ducked: boolean) {
    this.duckFactor = ducked ? 0.16 : 1
    this.applyActiveVolume()
  }

  setNarrativeDirection(intensity: number, silence: boolean, transitionSeconds: number, _regionId?: string) {
    const normalized = Math.max(0, Math.min(0.8, intensity))
    const target = silence ? 0.12 : 0.72 + normalized * 0.35
    const start = this.narrativeGain
    const duration = Math.max(2_000, Math.min(30_000, transitionSeconds * 1_000))
    const started = performance.now()
    cancelAnimationFrame(this.gainRaf)
    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      this.narrativeGain = start + (target - start) * eased
      if (this.state !== "crossfading") this.applyActiveVolume()
      if (progress < 1) this.gainRaf = requestAnimationFrame(frame)
    }
    this.gainRaf = requestAnimationFrame(frame)
  }

  async play(cue: MusicCue) {
    if (!cue.url) {
      this.cue = cue
      this.setState("error")
      return
    }
    const same = this.cue?.id === cue.id && this.cue?.url === cue.url && this.active >= 0
    const previousCue = this.cue
    const previousActive = this.active
    this.cue = cue
    if (same) {
      const deck = this.decks[this.active]
      deck.loop = cue.loop
      this.applyActiveVolume()
      try {
        await deck.play()
        this.setState("playing")
      } catch {
        this.setState("blocked")
      }
      return
    }

    const token = ++this.token
    cancelAnimationFrame(this.raf)
    const incomingIndex = this.active === 0 ? 1 : 0
    const incoming = this.decks[incomingIndex]
    const outgoing = this.active >= 0 ? this.decks[this.active] : null
    this.setState("loading")

    incoming.pause()
    if (this.objectUrls[incomingIndex]) URL.revokeObjectURL(this.objectUrls[incomingIndex]!)
    const localUrl = await cachedObjectUrl(cue.url)
    this.objectUrls[incomingIndex] = localUrl
    incoming.src = localUrl || cue.url
    incoming.loop = cue.loop
    incoming.currentTime = 0
    incoming.volume = 0
    incoming.load()

    try {
      await incoming.play()
    } catch {
      if (token === this.token) {
        if (outgoing) {
          incoming.removeAttribute("src")
          incoming.load()
          this.cue = previousCue
          this.active = previousActive
          this.setState("playing")
        } else {
          this.active = incomingIndex
          this.setState("blocked")
        }
      }
      return
    }
    if (token !== this.token) {
      incoming.pause()
      incoming.removeAttribute("src")
      incoming.load()
      return
    }
    this.active = incomingIndex

    const durationMs = Math.max(250, Math.min(20_000, cue.crossfadeSeconds * 1_000))
    const started = performance.now()
    const outgoingStart = outgoing?.volume ?? 0
    this.setState(outgoing ? "crossfading" : "playing")

    const frame = (now: number) => {
      if (token !== this.token) return
      const progress = Math.min(1, (now - started) / durationMs)
      const target = this.targetVolume()
      incoming.volume = Math.max(0, Math.min(1, target * progress))
      if (outgoing) outgoing.volume = Math.max(0, outgoingStart * (1 - progress))
      if (progress < 1) {
        this.raf = requestAnimationFrame(frame)
      } else {
        if (outgoing) {
          outgoing.pause()
          outgoing.currentTime = 0
          outgoing.removeAttribute("src")
          outgoing.load()
          if (previousActive >= 0 && this.objectUrls[previousActive]) {
            URL.revokeObjectURL(this.objectUrls[previousActive]!)
            this.objectUrls[previousActive] = null
          }
        }
        this.setState("playing")
      }
    }
    this.raf = requestAnimationFrame(frame)
  }

  pause() {
    if (this.active < 0) return
    this.decks[this.active].pause()
    this.setState("paused")
  }

  async resume() {
    if (this.active < 0 || !this.cue) return
    try {
      await this.decks[this.active].play()
      this.applyActiveVolume()
      this.setState("playing")
    } catch {
      this.setState("blocked")
    }
  }

  stop() {
    ++this.token
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.gainRaf)
    for (let index = 0; index < this.decks.length; index += 1) {
      const deck = this.decks[index]
      deck.pause()
      deck.currentTime = 0
      deck.volume = 0
      deck.removeAttribute("src")
      deck.load()
      if (this.objectUrls[index]) URL.revokeObjectURL(this.objectUrls[index]!)
      this.objectUrls[index] = null
    }
    this.active = -1
    this.cue = null
    this.narrativeGain = 1
    this.setState("idle")
  }

  dispose() {
    this.stop()
  }

  private targetVolume() {
    return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain))
  }

  private applyActiveVolume() {
    if (this.active >= 0) this.decks[this.active].volume = this.targetVolume()
  }

  private setState(state: MusicState) {
    this.state = state
    this.listener(this.state, this.cue)
  }
}
