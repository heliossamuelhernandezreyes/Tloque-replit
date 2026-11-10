import { AudioTransition, waitForMediaReady } from "./AudioTransition"
import { cachedObjectUrl } from "./AudioResourceCache"
import type { MusicCue, MusicState } from "./MusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void
interface LayerDeck { audio: HTMLAudioElement; objectUrl: string | null; gain: number }
interface LayerGroup { cue: MusicCue; decks: LayerDeck[]; mix: number }

/**
 * Drift-corrected stem player for authored Fonoteca scores. Each transition uses
 * two groups so a region remains audible while the next set of stems loads.
 */
export class AdaptiveLayerMusicEngine {
  private groups: [LayerGroup | null, LayerGroup | null] = [null, null]
  private active = -1
  private token = 0
  private readonly fade = new AudioTransition()
  private controller = new AbortController()
  private paused = false
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
    this.controller.abort(); this.controller = new AbortController(); this.paused = false
    const signal = this.controller.signal
    const outgoingIndex = this.active
    const incomingIndex = outgoingIndex === 0 ? 1 : 0
    this.disposeGroup(incomingIndex)
    this.listener("loading", cue)
    const prepared: LayerDeck[] = []
    const attemptsToPrepare = await Promise.allSettled(layers.map(async layer => {
      const objectUrl = await cachedObjectUrl(layer.url)
      if (signal.aborted) { if (objectUrl) URL.revokeObjectURL(objectUrl); return }
      const audio = new Audio()
      audio.preload = "auto"
      audio.crossOrigin = "anonymous"
      audio.src = objectUrl || layer.url
      audio.loop = cue.loop || layer.loop
      audio.setAttribute("playsinline", "")
      audio.volume = 0
      const deck = { audio, objectUrl, gain: layer.defaultGain }
      prepared.push(deck)
      const cancelled = () => this.disposeDeck(deck)
      signal.addEventListener("abort", cancelled, {once: true})
      try { audio.load(); await waitForMediaReady(audio, signal) }
      catch (error) { this.disposeDeck(deck); throw error }
      finally { signal.removeEventListener("abort", cancelled) }
      return deck
    }))
    if (token !== this.token) {
      prepared.forEach(deck => this.disposeDeck(deck))
      return
    }
    const ready = attemptsToPrepare.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : [])
    // All resources are ready before any media clock advances.
    ready.forEach(deck => { deck.audio.currentTime = 0 })
    const attempts = await Promise.allSettled(ready.map(deck => this.paused ? Promise.resolve() : deck.audio.play()))
    if (token !== this.token) {
      prepared.forEach(deck => this.disposeDeck(deck))
      return
    }
    const decks = ready.filter((deck, index) => {
      if (attempts[index].status === "fulfilled") return true
      this.disposeDeck(deck)
      return false
    })
    if (!decks.length) { this.listener("blocked", cue); return }
    const runtimeCue: MusicCue = {
      ...cue,
      playbackTier: decks.length === layers.length ? "native" : "hybrid",
    }
    if (this.paused) decks.forEach(deck => deck.audio.pause())
    this.groups[incomingIndex] = { cue: runtimeCue, decks, mix: 0 }
    this.active = incomingIndex
    this.startSyncMonitor()

    const outgoing = outgoingIndex >= 0 ? this.groups[outgoingIndex] : null
    const incoming = this.groups[incomingIndex]!
    const seconds = Math.max(0.25, Math.min(20, cue.crossfadeSeconds))
    this.listener(this.paused ? "paused" : outgoing ? "crossfading" : "playing", runtimeCue)
    this.fadeGroups(incoming, outgoing, seconds, token, () => {
      if (outgoingIndex >= 0) this.disposeGroup(outgoingIndex)
      if (token === this.token && !this.paused) this.listener("playing", runtimeCue)
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
    this.paused = true; this.fade.pause()
    this.groups.forEach(group => group?.decks.forEach(deck => deck.audio.pause()))
    this.listener("paused", this.active >= 0 ? this.groups[this.active]?.cue ?? null : null)
  }
  async resume() {
    this.paused = false
    const token = this.token
    const attempts = await Promise.allSettled(this.groups.flatMap(group => group?.decks ?? []).map(deck => deck.audio.play()))
    if (token !== this.token || this.paused || this.active < 0) return
    this.fade.resume(); this.applyActiveVolume()
    this.listener(attempts.some(result => result.status === "rejected") ? "blocked" : this.fade.active ? "crossfading" : "playing", this.groups[this.active]?.cue ?? null)
  }
  stop() {
    this.token += 1
    this.controller.abort(); this.fade.stop(); this.paused = false
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
    this.groups.forEach(group => { if (group) this.applyGroupVolume(group, group.mix) })
  }
  private fadeGroups(incoming: LayerGroup, outgoing: LayerGroup | null, seconds: number, token: number, done: () => void) {
    const previous = outgoing?.mix ?? 0
    this.fade.start(seconds, progress => {
      if (token !== this.token) return
      const eased = progress * progress * (3 - 2 * progress)
      incoming.mix = eased
      if (outgoing) outgoing.mix = previous * (1 - eased)
      this.applyActiveVolume()
    }, done, this.paused)
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
