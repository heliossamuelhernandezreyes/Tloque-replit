import { AudioTransition } from "./AudioTransition"
import { cachedObjectUrl } from "./AudioResourceCache"
import type { MusicBrainAudioLayer } from "@shared/music-brain"

export type MusicState = "idle" | "loading" | "playing" | "paused" | "crossfading" | "blocked" | "error"

export interface MusicCue {
  id: number
  title: string
  artist?: string
  sourceType?: "stream" | "procedural" | "soundfont" | "score" | "adaptive" | "sfx"
  url?: string
  recipe?: unknown
  packUrl?: string
  packSha256?: string
  packBytes?: number | null
  instrumentProgram?: number | null
  /** Explicit acoustic protocol for a curated module; null/undefined keeps generic GM fallback. */
  instrumentManifestId?: string | null
  loop: boolean
  volume: number
  crossfadeSeconds: number
  /** Studio-only full-scale monitoring; reader cues never set this. */
  monitoring?: "program" | "reference"
  /** Resolved live tier after native-pack preflight/load. */
  playbackTier?: "native" | "hybrid" | "synth"
  /** Explicit asset-free orchestral synthesis, never labeled as recorded native. */
  orchestralSynthesis?: boolean
  /** Instruments that are using the bounded synth fallback in this cue. */
  fallbackInstrumentIds?: readonly string[]
  /** Enables deterministic thinning/variation while a narrative region dwells. */
  adaptiveDwell?: boolean
  /** Published Fonoteca stems selected by stable Direction layer IDs. */
  adaptiveLayers?: readonly MusicBrainAudioLayer[]
}

type Listener = (state: MusicState, cue: MusicCue | null) => void

export class MusicEngine {
  private readonly decks: [HTMLAudioElement, HTMLAudioElement]
  private readonly weights = [0, 0]
  private readonly levels = [1, 1]
  private readonly objectUrls: [string | null, string | null] = [null, null]
  private readonly fade = new AudioTransition()
  private active = -1
  private cue: MusicCue | null = null
  private master = .35
  private duckFactor = 1
  private narrativeGain = 1
  private gainRaf = 0
  private token = 0
  private paused = false

  constructor(private readonly listener: Listener) {
    this.decks = [0, 1].map(index => {
      const audio = new Audio()
      audio.preload = 'auto'; audio.crossOrigin = 'anonymous'; audio.setAttribute('playsinline', '')
      audio.addEventListener('error', () => { if (index === this.active && audio.src) this.setState('error') })
      audio.addEventListener('ended', () => {
        if (index !== this.active || !this.cue || audio.loop) return
        this.fade.stop(); this.decks.forEach(deck => deck.pause()); this.setState('paused')
      })
      return audio
    }) as [HTMLAudioElement, HTMLAudioElement]
  }
  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? .16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, _regionId?: string) {
    const start = this.narrativeGain, target = silence ? 0 : .72 + Math.max(0, Math.min(.8, intensity)) * .35
    const began = performance.now(), duration = Math.max(250, Math.min(30_000, seconds * 1_000))
    cancelAnimationFrame(this.gainRaf)
    const frame = (now: number) => {
      const p = Math.min(1, (now - began) / duration), eased = p * p * (3 - 2 * p)
      this.narrativeGain = start + (target - start) * eased; this.applyVolume()
      if (p < 1) this.gainRaf = requestAnimationFrame(frame)
    }
    this.gainRaf = requestAnimationFrame(frame)
  }
  async play(cue: MusicCue) {
    if (!cue.url) { this.cue = cue; this.setState('error'); return }
    if (this.cue?.id === cue.id && this.cue.url === cue.url && this.active >= 0) {
      this.cue = cue; this.levels[this.active] = cue.volume; this.decks[this.active].loop = cue.loop
      this.applyVolume(); await this.resume(); return
    }
    const token = ++this.token, outgoing = this.active, incoming = outgoing === 0 ? 1 : 0
    const previousCue = this.cue
    this.paused = false; this.fade.stop(); this.clearDeck(incoming); this.cue = cue; this.setState('loading')
    const localUrl = await cachedObjectUrl(cue.url)
    if (token !== this.token) { if (localUrl) URL.revokeObjectURL(localUrl); return }
    const deck = this.decks[incoming]
    this.objectUrls[incoming] = localUrl; deck.src = localUrl || cue.url; deck.loop = cue.loop
    deck.volume = 0; deck.currentTime = 0; deck.load(); this.levels[incoming] = cue.volume
    try {
      if (!this.paused) await deck.play()
    } catch {
      if (token !== this.token) return
      if (outgoing >= 0) { this.clearDeck(incoming); this.cue = previousCue; this.setState(this.paused ? 'paused' : 'playing') }
      else { this.active = incoming; this.weights[incoming] = 1; this.applyVolume(); this.setState('blocked') }
      return
    }
    if (token !== this.token) return
    if (this.paused) deck.pause()
    this.active = incoming
    const startWeight = outgoing >= 0 ? this.weights[outgoing] : 0
    this.fade.start(Math.max(.25, Math.min(20, cue.crossfadeSeconds)), p => {
      this.weights[incoming] = p
      if (outgoing >= 0) this.weights[outgoing] = startWeight * (1 - p)
      this.applyVolume()
    }, () => {
      if (token !== this.token) return
      if (outgoing >= 0) this.clearDeck(outgoing)
      this.setState(this.paused ? 'paused' : 'playing')
    }, this.paused)
    this.setState(this.paused ? 'paused' : outgoing >= 0 ? 'crossfading' : 'playing')
  }
  pause() { this.paused = true; this.fade.pause(); this.decks.forEach(deck => deck.pause()); if (this.cue) this.setState('paused') }
  async resume() {
    this.paused = false
    const token = this.token
    if (this.active < 0 || !this.cue) return
    try {
      await Promise.all(this.decks.filter(deck => Boolean(deck.getAttribute('src'))).map(deck => deck.play()))
      if (token !== this.token || this.paused) return
      this.fade.resume(); this.applyVolume(); this.setState(this.fade.active ? 'crossfading' : 'playing')
    } catch { if (token === this.token && !this.paused) this.setState('blocked') }
  }
  stop() {
    ++this.token; this.paused = false; this.fade.stop(); cancelAnimationFrame(this.gainRaf)
    this.decks.forEach((_, index) => this.clearDeck(index)); this.active = -1; this.cue = null; this.narrativeGain = 1
    this.setState('idle')
  }
  dispose() { this.stop() }
  private clearDeck(index: number) {
    const deck = this.decks[index]; deck.pause(); deck.volume = 0; deck.removeAttribute('src'); deck.load()
    this.weights[index] = 0
    if (this.objectUrls[index]) URL.revokeObjectURL(this.objectUrls[index]!)
    this.objectUrls[index] = null
  }
  private applyVolume() {
    const master = this.master * this.duckFactor * this.narrativeGain
    this.decks.forEach((deck, index) => { deck.volume = Math.max(0, Math.min(1, master * this.levels[index] * this.weights[index])) })
  }
  private setState(state: MusicState) { this.listener(state, this.cue) }
}
