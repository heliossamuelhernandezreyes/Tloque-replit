import { linearScoreRecipeFor } from "@shared/audio"
import type { MusicCue, MusicState } from "./MusicEngine"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan } from "./NativeSampleScorePlan"
import { createSampledMixMaster } from "./ScoreMixMaster"

type Listener = (state: MusicState, cue: MusicCue | null) => void

export class NativeSampleScoreEngine {
  private context: AudioContext | null = null
  private cue: MusicCue | null = null
  private output: GainNode | null = null
  private completionTimer = 0
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    this.listener("loading", cue)
    this.stopRuntime()
    try {
      const recipe = linearScoreRecipeFor(cue.recipe)
      if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita un paquete nativo")
      const context = new AudioContext({ latencyHint: "playback" })
      const player = new NativeSamplePackPlayer(context)
      const packUrl = `/api/audio/sample-packs/modules/${encodeURIComponent(recipe.plan.moduleId)}.json`
      const pack = await player.loadPack(packUrl)
      if (pack.instrumentManifestId !== recipe.plan.moduleId && cue.instrumentManifestId !== pack.instrumentManifestId) {
        throw new Error("El paquete nativo no corresponde al módulo solicitado")
      }

      const plan = buildNativeSampleScorePlan(recipe, pack)
      const mix = createSampledMixMaster(context, 1)
      const output = context.createGain()
      output.gain.value = 0
      mix.output.connect(output)
      output.connect(context.destination)

      const trackGain = new Map<string, GainNode>()
      for (const track of plan.tracks) {
        const gain = context.createGain()
        gain.gain.value = track.gain
        if (typeof context.createStereoPanner === "function") {
          const panner = context.createStereoPanner()
          panner.pan.value = track.pan
          gain.connect(panner)
          panner.connect(mix.input)
        } else {
          gain.connect(mix.input)
        }
        trackGain.set(track.id, gain)
      }

      const decoded = await player.preload(plan.zones)
      const durationByUrl = new Map(plan.zones.map((zone, index) => [zone.sampleUrl, decoded[index]?.duration ?? 0]))
      await context.resume()

      this.context = context
      this.output = output
      this.cue = cue
      const startAt = context.currentTime + 0.08

      for (const control of plan.controls) {
        const gain = trackGain.get(control.trackId)
        if (!gain) continue
        const at = startAt + control.timeSeconds
        gain.gain.cancelScheduledValues(at)
        if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds)
        else gain.gain.setValueAtTime(control.gain, at)
      }

      const scheduled: Promise<unknown>[] = []
      for (const voice of plan.voices) {
        const destination = trackGain.get(voice.trackId)
        if (!destination) continue
        scheduled.push(player.play({
          pack,
          articulation: voice.articulation,
          note: voice.note,
          velocity: voice.velocity,
          roundRobin: voice.roundRobin,
          vibrato: voice.vibrato,
          mute: voice.mute,
          startTime: startAt + voice.startSeconds,
          durationSeconds: voice.durationSeconds,
          destination,
          oneShot: voice.oneShot,
        }))
      }
      await Promise.all(scheduled)

      const naturalEnd = plan.voices.reduce((latest, voice) => {
        if (!voice.oneShot || !voice.sampleUrl) return latest
        const physical = durationByUrl.get(voice.sampleUrl) ?? 0
        return Math.max(latest, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate))
      }, plan.totalSeconds)
      output.gain.linearRampToValueAtTime(this.targetVolume(), context.currentTime + Math.max(0.25, cue.crossfadeSeconds))
      this.completionTimer = window.setTimeout(() => {
        this.listener("paused", this.cue)
      }, (naturalEnd + 0.5) * 1_000)
      this.listener("playing", cue)
    } catch (error) {
      console.error("Tloque native sample playback failed:", error)
      this.stopRuntime()
      this.listener("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0.08 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    if (this.context && this.output) {
      const now = this.context.currentTime
      this.output.gain.cancelScheduledValues(now)
      this.output.gain.linearRampToValueAtTime(this.targetVolume(), now + Math.max(0.25, seconds))
    }
  }
  pause() { if (this.context) void this.context.suspend(); this.listener("paused", this.cue) }
  async resume() { if (this.context) await this.context.resume(); if (this.cue) this.listener("playing", this.cue) }
  stop() { this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }

  private targetVolume() {
    return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain))
  }
  private applyVolume() {
    if (!this.context || !this.output) return
    const now = this.context.currentTime
    this.output.gain.cancelScheduledValues(now)
    this.output.gain.linearRampToValueAtTime(this.targetVolume(), now + 0.18)
  }
  private stopRuntime() {
    window.clearTimeout(this.completionTimer)
    this.completionTimer = 0
    this.output?.disconnect()
    this.output = null
    if (this.context) void this.context.close()
    this.context = null
  }
}
