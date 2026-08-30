import { cachedObjectUrl } from "./AudioResourceCache"
import type { MusicCue, MusicState } from "./MusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void
interface LayerDeck { audio: HTMLAudioElement; objectUrl: string | null; gain: number }
interface LayerGroup { cue: MusicCue; decks: LayerDeck[] }

/**
 * Drift-corrected stem player for authored Fonoteca scores. Each transition uses
 * two groups so a region remains audible while the next set of stems loads.
 */
export class AdaptiveLayerMusicEngine {
  private groups: [LayerGroup | null, LayerGroup | null] = [null, null]
  private active = -1
  private token = 0
  private fadeRaf = 0
  private directionRaf = 0
  private syncTimer = 0
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    const layers = cue.adaptiveLayers ?? []
    if (!layers.length) { this.listener("error", cue); return }
    const token = ++this.token
    const outgoingIndex = this.active
    const incomingIndex = outgoingIndex === 0 ? 1 : 0
    this.disposeGroup(incomingIndex)
    this.listener("loading", cue)
    const prepared = await Promise.all(layers.map(async layer => {
      const objectUrl = await cachedObjectUrl(layer.url)
      const audio = new Audio()
      audio.preload = "auto"
      audio.crossOrigin = "anonymous"
      audio.src = objectUrl || layer.url
      audio.loop = cue.loop || layer.loop
      audio.setAttribute("playsinline", "")
      audio.volume = 0
      return { audio, objectUrl, gain: layer.defaultGain }
    }))
    if (token !== this.token) {
      prepared.forEach(deck => this.disposeDeck(deck))
      return
    }
    const attempts = await Promise.allSettled(prepared.map(deck => deck.audio.play()))
    if (token !== this.token) {
      prepared.forEach(deck => this.disposeDeck(deck))
      return
    }
    const decks = prepared.filter((deck, index) => {
      if (attempts[index].status === "fulfilled") return true
      this.disposeDeck(deck)
      return false
    })
    if (!decks.length) { this.listener("blocked", cue); return }
    const runtimeCue: MusicCue = {
      ...cue,
      playbackTier: decks.length === layers.length ? "native" : "hybrid",
    }
    this.groups[incomingIndex] = { cue: runtimeCue, decks }
    this.active = incomingIndex
    this.startSyncMonitor()

    const outgoing = outgoingIndex >= 0 ? this.groups[outgoingIndex] : null
    const incoming = this.groups[incomingIndex]!
    const seconds = Math.max(0.25, Math.min(20, cue.crossfadeSeconds))
    this.listener(outgoing ? "crossfading" : "playing", runtimeCue)
    this.fadeGroups(incoming, outgoing, seconds, token, () => {
      if (outgoingIndex >= 0) this.disposeGroup(outgoingIndex)
      if (token === this.token) this.listener("playing", runtimeCue)
    })
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyActiveVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyActiveVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    const target = silence ? 0 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    const start = this.narrativeGain
    const began = performance.now(), duration = Math.max(250, Math.min(30_000, seconds * 1_000))
    cancelAnimationFrame(this.directionRaf)
    const frame = (now: number) => {
      const progress = Math.min(1, (now - began) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      this.narrativeGain = start + (target - start) * eased
      this.applyActiveVolume()
      if (progress < 1) this.directionRaf = requestAnimationFrame(frame)
    }
    this.directionRaf = requestAnimationFrame(frame)
  }
  pause() {
    this.groups.forEach(group => group?.decks.forEach(deck => deck.audio.pause()))
    this.listener("paused", this.active >= 0 ? this.groups[this.active]?.cue ?? null : null)
  }
  async resume() {
    const group = this.active >= 0 ? this.groups[this.active] : null
    if (!group) return
    const results = await Promise.allSettled(group.decks.map(deck => deck.audio.play()))
    this.listener(results.some(result => result.status === "fulfilled") ? "playing" : "blocked", group.cue)
  }
  stop() {
    this.token += 1
    cancelAnimationFrame(this.fadeRaf)
    cancelAnimationFrame(this.directionRaf)
    window.clearInterval(this.syncTimer); this.syncTimer = 0
    this.disposeGroup(0); this.disposeGroup(1); this.active = -1
    this.listener("idle", null)
  }
  dispose() { this.stop() }

  private targetVolume() { return Math.max(0, Math.min(1, this.master * this.duckFactor * this.narrativeGain)) }
  private groupGain(group: LayerGroup) { return this.targetVolume() * group.cue.volume / Math.sqrt(Math.max(1, group.decks.length)) }
  private applyGroupVolume(group: LayerGroup, factor: number) {
    const base = this.groupGain(group) * Math.max(0, Math.min(1, factor))
    group.decks.forEach(deck => { deck.audio.volume = Math.max(0, Math.min(1, base * deck.gain)) })
  }
  private applyActiveVolume() {
    if (this.active >= 0 && this.groups[this.active]) this.applyGroupVolume(this.groups[this.active]!, 1)
  }
  private fadeGroups(incoming: LayerGroup, outgoing: LayerGroup | null, seconds: number, token: number, done: () => void) {
    cancelAnimationFrame(this.fadeRaf)
    const began = performance.now(), duration = seconds * 1_000
    const frame = (now: number) => {
      if (token !== this.token) return
      const progress = Math.min(1, (now - began) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      this.applyGroupVolume(incoming, eased)
      if (outgoing) this.applyGroupVolume(outgoing, 1 - eased)
      if (progress < 1) this.fadeRaf = requestAnimationFrame(frame)
      else done()
    }
    this.fadeRaf = requestAnimationFrame(frame)
  }
  private startSyncMonitor() {
    window.clearInterval(this.syncTimer)
    this.syncTimer = window.setInterval(() => {
      const group = this.active >= 0 ? this.groups[this.active] : null
      const leader = group?.decks[0]?.audio
      if (!group || !leader || leader.paused) return
      for (const deck of group.decks.slice(1)) {
        if (Math.abs(deck.audio.currentTime - leader.currentTime) > 0.08) deck.audio.currentTime = leader.currentTime
      }
    }, 2_000)
  }
  private disposeDeck(deck: LayerDeck) {
    deck.audio.pause(); deck.audio.removeAttribute("src"); deck.audio.load()
    if (deck.objectUrl) URL.revokeObjectURL(deck.objectUrl)
  }
  private disposeGroup(index: number) {
    this.groups[index]?.decks.forEach(deck => this.disposeDeck(deck))
    this.groups[index] = null
  }
}
