import { linearScoreRecipeFor } from "@shared/audio"
import { manifestsForModule } from "@shared/instrument-manifest"
import type { MusicCue, MusicState } from "./MusicEngine"
import { NativeSamplePackPlayer, selectNativeSampleZone } from "./NativeSamplePackEngine"
import { buildPerformancePlan } from "./PerformanceEngine"
import { createSampledMixMaster } from "./ScoreMixMaster"
import {
  articulationDurationFactor,
  articulationVelocityFactor,
  scoreTrackExpression,
  scoreTrackTimbre,
  scoreVelocityGain,
} from "./ScoreAudioMath"

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

      const performance = buildPerformancePlan(recipe, manifestsForModule(pack.instrumentManifestId))
      const mix = createSampledMixMaster(context, 1)
      const output = context.createGain()
      output.gain.value = 0
      mix.output.connect(output)
      output.connect(context.destination)

      const playableTracks = recipe.plan.tracks.slice(0, 16)
      const trackGain = new Map<string, GainNode>()
      const trackPan = new Map<string, StereoPannerNode | null>()
      for (const track of playableTracks) {
        const timbre = scoreTrackTimbre(track)
        const gain = context.createGain()
        gain.gain.value = Math.max(0, Math.min(1.5, track.gain * timbre.level * scoreTrackExpression(track)))
        let panner: StereoPannerNode | null = null
        if (typeof context.createStereoPanner === "function") {
          panner = context.createStereoPanner()
          panner.pan.value = Math.max(-1, Math.min(1, track.pan))
          gain.connect(panner)
          panner.connect(mix.input)
        } else {
          gain.connect(mix.input)
        }
        trackGain.set(track.id, gain)
        trackPan.set(track.id, panner)
      }

      const zonesNeeded = new Map<string, typeof pack.zones[number]>()
      for (let index = 0; index < recipe.plan.events.length; index += 1) {
        const event = recipe.plan.events[index]
        const decision = performance.decisionForEvent(index)
        if (!decision) continue
        const velocity = Math.round(Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(decision.articulation)) * 127)
        for (const note of event.notes) {
          const selection = selectNativeSampleZone(pack, decision.articulation, note, velocity, decision.roundRobin)
          if (selection) zonesNeeded.set(selection.zone.id, selection.zone)
        }
      }
      await player.preload(pack, [...zonesNeeded.values()])
      await context.resume()

      this.context = context
      this.output = output
      this.cue = cue
      const startAt = context.currentTime + 0.08
      const beatSeconds = 60 / recipe.plan.bpm

      for (const control of recipe.plan.controls) {
        const gain = trackGain.get(control.trackId)
        if (!gain || control.expression === null) continue
        const at = startAt + control.timeSeconds
        const track = playableTracks.find(item => item.id === control.trackId)
        if (!track) continue
        const timbre = scoreTrackTimbre(track)
        const value = Math.max(0, Math.min(1.5, track.gain * timbre.level * control.expression))
        gain.gain.cancelScheduledValues(at)
        if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(value, at + control.rampSeconds)
        else gain.gain.setValueAtTime(value, at)
      }

      const scheduled: Promise<unknown>[] = []
      for (let index = 0; index < recipe.plan.events.length; index += 1) {
        const event = recipe.plan.events[index]
        const decision = performance.decisionForEvent(index)
        const destination = trackGain.get(event.trackId)
        if (!decision || !destination) continue
        const eventStart = "timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds
        const duration = ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds)
          * articulationDurationFactor(decision.articulation)
        const velocity = Math.round(Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(decision.articulation)) * 127)
        for (const note of event.notes) {
          scheduled.push(player.play({
            pack,
            articulation: decision.articulation,
            note,
            velocity,
            roundRobin: decision.roundRobin,
            startTime: startAt + eventStart,
            durationSeconds: duration,
            destination,
          }))
        }
      }
      await Promise.all(scheduled)

      const totalSeconds = recipe.plan.totalSeconds
      output.gain.linearRampToValueAtTime(this.targetVolume(), context.currentTime + Math.max(0.25, cue.crossfadeSeconds))
      this.completionTimer = window.setTimeout(() => {
        this.listener("paused", this.cue)
      }, (totalSeconds + 0.5) * 1_000)
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
