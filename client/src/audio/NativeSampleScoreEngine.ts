import { linearScoreRecipeFor } from "@shared/audio"
import type { MusicCue, MusicState } from "./MusicEngine"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"
import { createSampledMixMaster } from "./ScoreMixMaster"
import { nativeModuleGroupsForRecipe, recipeForNativeModule } from "./NativeAutoModule"

type Listener = (state: MusicState, cue: MusicCue | null) => void

interface LoadedNativePlan {
  moduleId: string
  plan: NativeSampleScorePlan
  player: NativeSamplePackPlayer
  durationByUrl: Map<string, number>
}

function createRealtimeAudioContext() {
  try {
    return new AudioContext({ latencyHint: "playback", sampleRate: 48_000 })
  } catch {
    return new AudioContext({ latencyHint: "playback" })
  }
}

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
      if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita paquetes nativos")
      const context = createRealtimeAudioContext()
      const groups = nativeModuleGroupsForRecipe(recipe)
      const loaded: LoadedNativePlan[] = []

      for (const group of groups) {
        const player = new NativeSamplePackPlayer(context)
        const packUrl = `/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`
        const pack = await player.loadPack(packUrl)
        if (pack.instrumentManifestId !== group.moduleId) throw new Error(`El paquete nativo ${group.moduleId} no corresponde a su manifest`)
        const subRecipe = recipeForNativeModule(recipe, group)
        const plan = buildNativeSampleScorePlan(subRecipe, pack)
        const decoded = await player.preload(plan.zones)
        loaded.push({
          moduleId: group.moduleId,
          plan,
          player,
          durationByUrl: new Map(plan.zones.map((zone, index) => [zone.sampleUrl, decoded[index]?.duration ?? 0])),
        })
      }

      const mix = createSampledMixMaster(context, 1)
      const output = context.createGain(); output.gain.value = 0; mix.output.connect(output); output.connect(context.destination)
      const trackGain = new Map<string, GainNode>()
      for (const { plan } of loaded) {
        for (const track of plan.tracks) {
          if (trackGain.has(track.id)) continue
          const gain = context.createGain(); gain.gain.value = track.gain
          if (typeof context.createStereoPanner === "function") {
            const panner = context.createStereoPanner(); panner.pan.value = track.pan; gain.connect(panner); panner.connect(mix.input)
          } else gain.connect(mix.input)
          trackGain.set(track.id, gain)
        }
      }

      // On mobile, scheduling hundreds of BufferSource nodes after resume can consume
      // more than the old 80 ms lead and collapse early notes onto `currentTime`.
      // Freeze the audio clock, schedule the complete graph, then resume it as one
      // deterministic performance. This makes live native playback much closer to
      // the OfflineAudioContext master render.
      if (context.state === "running") await context.suspend()
      this.context = context; this.output = output; this.cue = cue
      const startAt = context.currentTime + 0.12
      let naturalEnd = recipe.plan.totalSeconds
      const scheduled: Promise<unknown>[] = []

      for (const { plan, player, durationByUrl } of loaded) {
        for (const control of plan.controls) {
          const gain = trackGain.get(control.trackId); if (!gain) continue
          const at = startAt + control.timeSeconds; gain.gain.cancelScheduledValues(at)
          if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds)
          else gain.gain.setValueAtTime(control.gain, at)
        }

        const zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))
        for (const voice of plan.voices) {
          const destination = trackGain.get(voice.trackId), zone = zoneById.get(voice.zoneId)
          if (!destination || !zone) continue
          scheduled.push(player.playSelection(
            { zone, playbackRate: voice.playbackRate, gain: voice.sampleGain },
            startAt + voice.startSeconds,
            voice.durationSeconds,
            destination,
            0,
            voice.oneShot,
          ))
          if (voice.oneShot) {
            const physical = durationByUrl.get(voice.sampleUrl) ?? 0
            naturalEnd = Math.max(naturalEnd, voice.startSeconds + physical / Math.max(0.01, voice.playbackRate))
          }
        }
        for (const auxiliary of plan.auxiliaryVoices) {
          const destination = trackGain.get(auxiliary.trackId), zone = zoneById.get(auxiliary.zoneId)
          if (!destination || !zone) continue
          scheduled.push(player.playSelection(
            { zone, playbackRate: auxiliary.playbackRate, gain: auxiliary.sampleGain },
            startAt + auxiliary.startSeconds,
            auxiliary.durationSeconds,
            destination,
            0,
            true,
          ))
          const physical = durationByUrl.get(auxiliary.sampleUrl) ?? 0
          naturalEnd = Math.max(naturalEnd, auxiliary.startSeconds + physical / Math.max(0.01, auxiliary.playbackRate))
        }
      }
      await Promise.all(scheduled)

      const fadeSeconds = Math.max(0.08, Math.min(0.35, cue.crossfadeSeconds || 0.12))
      output.gain.setValueAtTime(0, startAt)
      output.gain.linearRampToValueAtTime(this.targetVolume(), startAt + fadeSeconds)
      await context.resume()
      this.completionTimer = window.setTimeout(() => { this.listener("paused", this.cue) }, (naturalEnd + 0.5) * 1_000)
      this.listener("playing", cue)
    } catch (error) {
      console.error("Tloque native sample playback failed:", error)
      this.stopRuntime(); this.listener("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0.08 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    if (this.context && this.output) { const now = this.context.currentTime; this.output.gain.cancelScheduledValues(now); this.output.gain.linearRampToValueAtTime(this.targetVolume(), now + Math.max(0.25, seconds)) }
  }
  pause() { if (this.context) void this.context.suspend(); this.listener("paused", this.cue) }
  async resume() { if (this.context) await this.context.resume(); if (this.cue) this.listener("playing", this.cue) }
  stop() { this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }
  private targetVolume() { return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain)) }
  private applyVolume() { if (!this.context || !this.output) return; const now = this.context.currentTime; this.output.gain.cancelScheduledValues(now); this.output.gain.linearRampToValueAtTime(this.targetVolume(), now + 0.18) }
  private stopRuntime() { window.clearTimeout(this.completionTimer); this.completionTimer = 0; this.output?.disconnect(); this.output = null; if (this.context) void this.context.close(); this.context = null }
}
