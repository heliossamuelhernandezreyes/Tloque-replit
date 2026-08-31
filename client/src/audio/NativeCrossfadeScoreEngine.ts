import type { MusicCue, MusicState } from "./MusicEngine"
import { NativeSampleScoreEngine } from "./NativeSampleScoreEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void

/**
 * Two native decks keep the current region alive while the next region loads.
 * Gain ramps are scheduled inside each deck against its AudioContext clock;
 * this wrapper only owns deck selection and public state.
 */
export class NativeCrossfadeScoreEngine {
  private readonly decks: [NativeSampleScoreEngine, NativeSampleScoreEngine]
  private readonly states: [MusicState, MusicState] = ["idle", "idle"]
  private readonly cues: [MusicCue | null, MusicCue | null] = [null, null]
  private active = -1
  private pending = -1
  private token = 0
  private stateTimer = 0
  private master = 0.35
  private ducked = false
  private direction = { intensity: 0, silence: false, seconds: 1 }

  constructor(private readonly listener: Listener) {
    this.decks = [0, 1].map(index => new NativeSampleScoreEngine((state, cue) => {
      const previousTier = this.cues[index]?.playbackTier
      this.states[index] = state
      this.cues[index] = cue
      if (index === this.active && this.pending < 0 && (state === "paused" || state === "error" || (state === "playing" && previousTier !== cue?.playbackTier))) {
        this.listener(state, cue)
      }
    })) as [NativeSampleScoreEngine, NativeSampleScoreEngine]
  }

  async play(cue: MusicCue) {
    const token = ++this.token
    window.clearTimeout(this.stateTimer)
    if (this.pending >= 0) this.decks[this.pending].stop()
    const outgoing = this.active
    const incoming = outgoing === 0 ? 1 : 0
    this.pending = incoming
    const deck = this.decks[incoming]
    deck.setMasterVolume(this.master)
    deck.setDucked(this.ducked)
    deck.setNarrativeDirection(this.direction.intensity, this.direction.silence, this.direction.seconds)
    this.listener("loading", cue)
    const startDelay = await deck.play(cue, () => outgoing >= 0
      ? this.decks[outgoing].secondsUntilNextBar(Math.min(4, cue.crossfadeSeconds * 0.5))
      : 0)
    if (token !== this.token) {
      deck.fadeOutAndStop(0.08)
      return
    }
    if (this.states[incoming] === "error") {
      this.pending = -1
      if (outgoing >= 0) this.listener("playing", this.cues[outgoing])
      else this.listener("error", cue)
      return
    }

    this.active = incoming
    this.pending = -1
    const resolvedCue = this.cues[incoming] ?? cue
    if (outgoing < 0) {
      this.listener("playing", resolvedCue)
      return
    }

    const seconds = Math.max(0.25, Math.min(20, cue.crossfadeSeconds))
    this.listener("crossfading", resolvedCue)
    this.decks[outgoing].fadeOutAndStop(seconds, startDelay)
    this.stateTimer = window.setTimeout(() => {
      if (token === this.token && this.active === incoming) this.listener("playing", this.cues[incoming] ?? resolvedCue)
    }, (startDelay + seconds) * 1_000)
  }

  setMasterVolume(value: number) {
    this.master = Math.max(0, Math.min(1, value))
    this.decks.forEach(deck => deck.setMasterVolume(this.master))
  }
  setDucked(value: boolean) {
    this.ducked = value
    this.decks.forEach(deck => deck.setDucked(value))
  }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.direction = { intensity, silence, seconds }
    this.decks.forEach(deck => deck.setNarrativeDirection(intensity, silence, seconds))
  }
  pause() {
    window.clearTimeout(this.stateTimer)
    this.decks.forEach((deck, index) => {
      if (this.states[index] === "playing") deck.pause()
    })
    this.listener("paused", this.active >= 0 ? this.cues[this.active] : null)
  }
  async resume() {
    if (this.active < 0) return
    await this.decks[this.active].resume()
    this.listener("playing", this.cues[this.active])
  }
  stop() {
    this.token += 1
    window.clearTimeout(this.stateTimer)
    this.decks.forEach(deck => deck.stop())
    this.active = -1
    this.pending = -1
    this.listener("idle", null)
  }
  dispose() { this.stop() }
}
