import { linearScoreRecipeFor } from "@shared/audio"
import { nativePhysicalModelByModuleId } from "@shared/native-acoustic-source"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { hybridEnabledForArticulation, nativeHybridForInstrument } from "@shared/native-hybrid-source"
import { scheduleHybridPhysicalOverlay } from "./HybridPhysicalOverlay"
import type { MusicCue, MusicState } from "./MusicEngine"
import { nativeModuleGroupsForRecipe, recipeForNativeModule, type NativeModuleGroup } from "./NativeAutoModule"
import { buildNativeRecipeIndex, nativeTrackAtTime } from "./NativeRecipeIndex"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"
import { schedulePhysicalReedVoice } from "./PhysicalReedModel"
import { createAcousticStage } from "./ScoreAcousticStage"
import { createSampledMixMaster } from "./ScoreMixMaster"

type Listener = (state: MusicState, cue: MusicCue | null) => void

interface LoadedNativePlan {
  moduleId: string
  plan: NativeSampleScorePlan
  player: NativeSamplePackPlayer
  durationByUrl: Map<string, number>
}

function createRealtimeAudioContext() {
  try { return new AudioContext({ latencyHint: "playback", sampleRate: 48_000 }) }
  catch { return new AudioContext({ latencyHint: "playback" }) }
}
function brightnessCutoff(value: number) {
  const amount = Math.max(0, Math.min(1, value))
  return 3_400 + Math.pow(amount, 0.72) * 16_000
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
      if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita fuentes acústicas nativas")
      const context = createRealtimeAudioContext()
      const groups = nativeModuleGroupsForRecipe(recipe)
      const sampleGroups: NativeModuleGroup[] = [], physicalGroups: NativeModuleGroup[] = []
      for (const group of groups) (nativePhysicalModelByModuleId(group.moduleId) ? physicalGroups : sampleGroups).push(group)

      const loaded: LoadedNativePlan[] = []
      for (const group of sampleGroups) {
        const player = new NativeSamplePackPlayer(context)
        const packUrl = `/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`
        const pack = await player.loadPack(packUrl)
        if (pack.instrumentManifestId !== group.moduleId) throw new Error(`El paquete nativo ${group.moduleId} no corresponde a su manifest`)
        const plan = buildNativeSampleScorePlan(recipeForNativeModule(recipe, group), pack)
        const decoded = await player.preload(plan.zones)
        loaded.push({ moduleId: group.moduleId, plan, player, durationByUrl: new Map(plan.zones.map((zone, index) => [zone.sampleUrl, decoded[index]?.duration ?? 0])) })
      }

      const mix = createSampledMixMaster(context, 1)
      const stage = createAcousticStage(context, mix.input)
      const output = context.createGain(); output.gain.value = 0; mix.output.connect(output); output.connect(context.destination)
      const trackGain = new Map<string, GainNode>(), trackTone = new Map<string, BiquadFilterNode>()
      const index = buildNativeRecipeIndex(recipe)
      const createTrackPath = (trackId: string, gainValue: number, brightness: number, pan: number) => {
        if (trackGain.has(trackId)) return
        const semanticTrack = index.trackById.get(trackId)
        const gain = context.createGain(); gain.gain.value = gainValue
        const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = brightnessCutoff(brightness); tone.Q.value = 0.12
        const stageInput = stage.createTrackInput(semanticTrack?.instrument ?? "unknown", pan)
        gain.connect(tone); tone.connect(stageInput); trackGain.set(trackId, gain); trackTone.set(trackId, tone)
      }

      for (const { plan } of loaded) for (const track of plan.tracks) createTrackPath(track.id, track.gain, track.brightness, track.pan)
      for (const group of physicalGroups) for (const trackId of group.trackIds) {
        const track = index.trackById.get(trackId)
        if (track) createTrackPath(track.id, track.gain * track.expression, track.brightness, track.pan)
      }

      if (context.state === "running") await context.suspend()
      this.context = context; this.output = output; this.cue = cue
      const startAt = context.currentTime + 0.12
      let naturalEnd = recipe.plan.totalSeconds
      const scheduled: Promise<unknown>[] = []

      for (const { plan, player, durationByUrl } of loaded) {
        for (const control of plan.controls) {
          const gain = trackGain.get(control.trackId), tone = trackTone.get(control.trackId), at = startAt + control.timeSeconds
          if (gain && control.gain !== null) {
            gain.gain.cancelScheduledValues(at)
            if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(control.gain, at + control.rampSeconds); else gain.gain.setValueAtTime(control.gain, at)
          }
          if (tone && control.brightness !== null) {
            const cutoff = brightnessCutoff(control.brightness); tone.frequency.cancelScheduledValues(at)
            if (control.rampSeconds > 0) tone.frequency.exponentialRampToValueAtTime(cutoff, at + control.rampSeconds); else tone.frequency.setValueAtTime(cutoff, at)
          }
        }
        const zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))
        for (const voice of plan.voices) {
          const destination = trackGain.get(voice.trackId), zone = zoneById.get(voice.zoneId)
          if (!destination || !zone) continue
          scheduled.push(player.playSelection({ zone, playbackRate: voice.playbackRate, gain: voice.sampleGain }, startAt + voice.startSeconds, voice.durationSeconds, destination, 0, voice.oneShot, voice.fadeInSeconds > 0 ? { fadeInSeconds: voice.fadeInSeconds } : undefined))
          if (voice.oneShot) naturalEnd = Math.max(naturalEnd, voice.startSeconds + (durationByUrl.get(voice.sampleUrl) ?? 0) / Math.max(0.01, voice.playbackRate))
        }
        for (const auxiliary of plan.auxiliaryVoices) {
          const destination = trackGain.get(auxiliary.trackId), zone = zoneById.get(auxiliary.zoneId)
          if (!destination || !zone) continue
          scheduled.push(player.playSelection({ zone, playbackRate: auxiliary.playbackRate, gain: auxiliary.sampleGain }, startAt + auxiliary.startSeconds, auxiliary.durationSeconds, destination, 0, true, auxiliary.fadeOutSeconds > 0 ? { fadeOutSeconds: auxiliary.fadeOutSeconds } : undefined))
          naturalEnd = Math.max(naturalEnd, auxiliary.startSeconds + (durationByUrl.get(auxiliary.sampleUrl) ?? 0) / Math.max(0.01, auxiliary.playbackRate))
        }
      }

      const previousHybridEndByTrack = new Map<string, number>()
      for (const event of index.chronologicalEvents) {
        const track = index.trackById.get(event.trackId), destination = trackGain.get(event.trackId)
        if (!track || !destination || !hybridEnabledForArticulation(track.instrument, event.articulation)) continue
        const hybrid = nativeHybridForInstrument(track.instrument)
        if (!hybrid || (recipe.plan.quality === "master" && !hybridSourceMasterApproved(hybrid))) continue
        const controls = index.controlsByTrack.get(event.trackId) ?? []
        const effectiveTrack = nativeTrackAtTime(track, controls, event.timeSeconds)
        const previousEnd = previousHybridEndByTrack.get(event.trackId)
        const legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
        for (const midi of event.notes) {
          const overlay = scheduleHybridPhysicalOverlay(context, hybrid, { startAt, event, track: effectiveTrack, midi, destination, controls, legatoFromPrevious })
          if (overlay) naturalEnd = Math.max(naturalEnd, overlay.endSeconds)
        }
        previousHybridEndByTrack.set(event.trackId, event.timeSeconds + event.durationSeconds)
      }

      for (const group of physicalGroups) {
        const model = nativePhysicalModelByModuleId(group.moduleId)
        if (!model) continue
        for (const trackId of group.trackIds) {
          const track = index.trackById.get(trackId), gain = trackGain.get(trackId), tone = trackTone.get(trackId)
          if (!track) continue
          for (const control of index.controlsByTrack.get(trackId) ?? []) {
            const at = startAt + control.timeSeconds
            if (gain && control.expression !== null) {
              const target = track.gain * control.expression; gain.gain.cancelScheduledValues(at)
              if (control.rampSeconds > 0) gain.gain.linearRampToValueAtTime(target, at + control.rampSeconds); else gain.gain.setValueAtTime(target, at)
            }
            if (tone && control.brightness !== null) {
              const cutoff = brightnessCutoff(control.brightness); tone.frequency.cancelScheduledValues(at)
              if (control.rampSeconds > 0) tone.frequency.exponentialRampToValueAtTime(cutoff, at + control.rampSeconds); else tone.frequency.setValueAtTime(cutoff, at)
            }
          }
        }

        const previousEndByTrack = new Map<string, number>()
        for (const trackId of group.trackIds) {
          const track = index.trackById.get(trackId), destination = trackGain.get(trackId)
          if (!track || !destination) continue
          const controls = index.controlsByTrack.get(trackId) ?? []
          for (const event of index.eventsByTrack.get(trackId) ?? []) {
            const effectiveTrack = nativeTrackAtTime(track, controls, event.timeSeconds)
            const previousEnd = previousEndByTrack.get(trackId)
            const legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
            for (const midi of event.notes) {
              const voice = schedulePhysicalReedVoice(context, model, { startAt, event, track: effectiveTrack, midi, destination, controls, legatoFromPrevious })
              naturalEnd = Math.max(naturalEnd, voice.endSeconds)
            }
            previousEndByTrack.set(trackId, event.timeSeconds + event.durationSeconds)
          }
        }
      }

      await Promise.all(scheduled)
      const fadeSeconds = Math.max(0.08, Math.min(0.35, cue.crossfadeSeconds || 0.12))
      output.gain.setValueAtTime(0, startAt); output.gain.linearRampToValueAtTime(this.targetVolume(), startAt + fadeSeconds)
      await context.resume()
      this.completionTimer = window.setTimeout(() => { this.listener("paused", this.cue) }, (naturalEnd + 0.5) * 1_000)
      this.listener("playing", cue)
    } catch (error) {
      console.error("Tloque native acoustic playback failed:", error)
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
