import { linearScoreRecipeFor, type LinearScoreTrack } from "@shared/audio"
import type { MusicCue, MusicState } from "./MusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void

// Ejecuta únicamente el plan compilado. El texto TloqueScore nunca llega a
// eval/Function ni se interpreta como JavaScript en el dispositivo.
export class LinearScoreEngine {
  private tone: typeof import("tone") | null = null
  private cue: MusicCue | null = null
  private output: any = null
  private synths = new Map<string, any>()
  private nodes: any[] = []
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    this.listener("loading", cue)
    try {
      this.stopRuntime()
      const Tone = this.tone ?? await import("tone")
      this.tone = Tone
      await Tone.start()
      const recipe = linearScoreRecipeFor(cue.recipe)
      const output = new Tone.Gain(0).toDestination()
      const limiter = new Tone.Limiter(-5)
      limiter.connect(output)
      this.output = output
      this.nodes = [limiter, output]
      this.cue = cue

      for (const track of recipe.plan.tracks) {
        const synth = this.createSynth(Tone, track)
        const panner = new Tone.Panner(track.pan)
        const gain = new Tone.Gain(track.gain)
        synth.chain(panner, gain, limiter)
        this.synths.set(track.id, synth)
        this.nodes.push(panner, gain)
      }

      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      transport.bpm.value = recipe.plan.bpm
      transport.timeSignature = [recipe.plan.meter.numerator, recipe.plan.meter.denominator]
      const beatSeconds = 60 / recipe.plan.bpm

      for (const event of recipe.plan.events) {
        transport.schedule(time => {
          this.synths.get(event.trackId)?.triggerAttackRelease(
            event.notes,
            event.durationBeats * beatSeconds,
            time,
            event.velocity,
          )
        }, event.timeBeats * beatSeconds)
      }

      const totalSeconds = recipe.plan.totalBeats * beatSeconds
      transport.loopStart = 0
      transport.loopEnd = totalSeconds
      transport.loop = cue.loop && recipe.plan.loop
      if (!transport.loop) {
        transport.schedule(time => {
          for (const synth of this.synths.values()) synth.releaseAll?.(time)
          transport.stop(time + 0.05)
          this.listener("paused", this.cue)
        }, totalSeconds)
      }
      transport.start()
      output.gain.rampTo(this.targetVolume(), Math.max(0.2, cue.crossfadeSeconds))
      this.listener("playing", cue)
    } catch (error) {
      console.error("TloqueScore playback failed:", error)
      this.stopRuntime()
      this.listener("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0.08 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    this.output?.gain.rampTo(this.targetVolume(), Math.max(0.25, seconds))
  }
  pause() { this.tone?.getTransport().pause(); this.listener("paused", this.cue) }
  async resume() {
    if (!this.tone || !this.cue) return
    await this.tone.start()
    this.tone.getTransport().start()
    this.listener("playing", this.cue)
  }
  stop() { this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }

  private createSynth(Tone: typeof import("tone"), track: LinearScoreTrack) {
    const envelope = track.synth === "pad"
      ? { attack: 1.1, decay: 0.7, sustain: 0.72, release: 3.8 }
      : track.synth === "bell"
        ? { attack: 0.008, decay: 1.1, sustain: 0.04, release: 2.4 }
        : track.synth === "pluck"
          ? { attack: 0.003, decay: 0.25, sustain: 0.08, release: 0.7 }
          : track.synth === "bass"
            ? { attack: 0.02, decay: 0.4, sustain: 0.55, release: 1.2 }
            : { attack: 0.12, decay: 0.45, sustain: 0.52, release: 1.8 }
    const oscillator = track.synth === "bass" ? "triangle" : track.synth === "pluck" ? "sine" : "fatsine"
    return new Tone.PolySynth(Tone.Synth, { oscillator: { type: oscillator as any }, envelope })
  }

  private targetVolume() {
    return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain))
  }
  private applyVolume() { this.output?.gain.rampTo(this.targetVolume(), 0.18) }
  private stopRuntime() {
    const transport = this.tone?.getTransport()
    transport?.stop()
    transport?.cancel()
    for (const synth of this.synths.values()) {
      synth.releaseAll?.()
      synth.dispose?.()
    }
    this.synths.clear()
    for (const node of this.nodes) node?.dispose?.()
    this.nodes = []
    this.output = null
  }
}
