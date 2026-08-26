import { linearScoreRecipeFor } from "@shared/audio"
import { nativePhysicalModelByModuleId } from "@shared/native-acoustic-source"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { hybridEnabledForArticulation, nativeHybridForInstrument } from "@shared/native-hybrid-source"
import { scheduleHybridPhysicalOverlay } from "./HybridPhysicalOverlay"
import type { MusicCue, MusicState } from "./MusicEngine"
import { nativeModuleGroupsForRecipe, recipeForNativeModule, type NativeModuleGroup } from "./NativeAutoModule"
import { buildNativeProgressivePreloadPlan } from "./NativeProgressivePreload"
import { buildNativeRecipeIndex, nativeTrackAtTime } from "./NativeRecipeIndex"
import { NativeRealtimeLookahead, NATIVE_REALTIME_TICK_MS, type NativeRealtimeTask } from "./NativeRealtimeLookahead"
import { createNativeRenderGraph } from "./NativeRenderGraph"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"
import { schedulePhysicalReedVoice } from "./PhysicalReedModel"

type Listener = (state: MusicState, cue: MusicCue | null) => void

interface LoadedNativePlan {
  moduleId: string
  plan: NativeSampleScorePlan
  player: NativeSamplePackPlayer
}

function createRealtimeAudioContext() {
  try { return new AudioContext({ latencyHint: "playback", sampleRate: 48_000 }) }
  catch { return new AudioContext({ latencyHint: "playback" }) }
}

export class NativeSampleScoreEngine {
  private context: AudioContext | null = null
  private cue: MusicCue | null = null
  private output: GainNode | null = null
  private completionTimer = 0
  private schedulerTimer = 0
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
        loaded.push({ moduleId: group.moduleId, plan, player })
      }

      const index = buildNativeRecipeIndex(recipe)
      const graph = createNativeRenderGraph(context, index.trackById)
      const output = context.createGain(); output.gain.value = 0; graph.output.connect(output); output.connect(context.destination)

      for (const { plan } of loaded) for (const track of plan.tracks) graph.createTrackPath(track.id, track.gain, track.brightness, track.pan)
      for (const group of physicalGroups) for (const trackId of group.trackIds) {
        const track = index.trackById.get(trackId)
        if (track) graph.createTrackPath(track.id, track.gain * track.expression, track.brightness, track.pan)
      }

      if (context.state === "running") await context.suspend()
      this.context = context; this.output = output; this.cue = cue
      const startAt = context.currentTime + 0.12
      let naturalEnd = recipe.plan.totalSeconds
      const realtimeTasks: NativeRealtimeTask[] = []

      for (const { plan, player } of loaded) {
        for (const control of plan.controls) graph.scheduleTrackControl(control, startAt)
        const zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))

        // Warm a physical WAV well before its first voice. NativeSamplePackPlayer
        // caches the in-flight decode promise, so a playback task can safely reuse
        // the same request if slow storage/network overlaps the scheduling window.
        for (const preload of buildNativeProgressivePreloadPlan(plan)) {
          realtimeTasks.push({
            timeSeconds: preload.preloadAtSeconds,
            run: async () => { await player.preload([preload.zone]) },
          })
        }

        for (const voice of plan.voices) {
          const destination = graph.trackGain.get(voice.trackId), zone = zoneById.get(voice.zoneId)
          if (!destination || !zone) continue
          realtimeTasks.push({
            timeSeconds: voice.startSeconds,
            run: () => player.playSelection(
              { zone, playbackRate: voice.playbackRate, gain: voice.sampleGain },
              startAt + voice.startSeconds,
              voice.durationSeconds,
              destination,
              0,
              voice.oneShot,
              voice.fadeInSeconds > 0 ? { fadeInSeconds: voice.fadeInSeconds } : undefined,
            ),
          })
          // Realtime no needs every sample decoded up front just to discover its
          // physical tail. Keep completion conservative without reintroducing the
          // eager preload: one-shots get a bounded eight-second safety tail.
          if (voice.oneShot) naturalEnd = Math.max(naturalEnd, voice.startSeconds + Math.max(voice.durationSeconds, 8))
        }
        for (const auxiliary of plan.auxiliaryVoices) {
          const destination = graph.trackGain.get(auxiliary.trackId), zone = zoneById.get(auxiliary.zoneId)
          if (!destination || !zone) continue
          realtimeTasks.push({
            timeSeconds: auxiliary.startSeconds,
            run: () => player.playSelection(
              { zone, playbackRate: auxiliary.playbackRate, gain: auxiliary.sampleGain },
              startAt + auxiliary.startSeconds,
              auxiliary.durationSeconds,
              destination,
              0,
              true,
              auxiliary.fadeOutSeconds > 0 ? { fadeOutSeconds: auxiliary.fadeOutSeconds } : undefined,
            ),
          })
          naturalEnd = Math.max(naturalEnd, auxiliary.startSeconds + Math.max(auxiliary.durationSeconds, 2))
        }
      }

      const previousHybridEndByTrack = new Map<string, number>()
      for (const event of index.chronologicalEvents) {
        const track = index.trackById.get(event.trackId), destination = graph.trackGain.get(event.trackId)
        if (!track || !destination || !hybridEnabledForArticulation(track.instrument, event.articulation)) continue
        const hybrid = nativeHybridForInstrument(track.instrument)
        if (!hybrid || (recipe.plan.quality === "master" && !hybridSourceMasterApproved(hybrid))) continue
        const controls = index.controlsByTrack.get(event.trackId) ?? []
        const effectiveTrack = nativeTrackAtTime(track, controls, event.timeSeconds)
        const previousEnd = previousHybridEndByTrack.get(event.trackId)
        const legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
        realtimeTasks.push({
          timeSeconds: event.timeSeconds,
          run: () => {
            for (const midi of event.notes) scheduleHybridPhysicalOverlay(context, hybrid, { startAt, event, track: effectiveTrack, midi, destination, controls, legatoFromPrevious })
          },
        })
        naturalEnd = Math.max(naturalEnd, event.timeSeconds + event.durationSeconds + 7)
        previousHybridEndByTrack.set(event.trackId, event.timeSeconds + event.durationSeconds)
      }

      for (const group of physicalGroups) {
        const model = nativePhysicalModelByModuleId(group.moduleId)
        if (!model) continue
        for (const trackId of group.trackIds) {
          const track = index.trackById.get(trackId)
          if (!track) continue
          for (const control of index.controlsByTrack.get(trackId) ?? []) {
            graph.scheduleTrackControl({
              trackId,
              timeSeconds: control.timeSeconds,
              rampSeconds: control.rampSeconds,
              gain: control.expression === null ? null : track.gain * control.expression,
              brightness: control.brightness,
            }, startAt)
          }
        }

        const previousEndByTrack = new Map<string, number>()
        for (const trackId of group.trackIds) {
          const track = index.trackById.get(trackId), destination = graph.trackGain.get(trackId)
          if (!track || !destination) continue
          const controls = index.controlsByTrack.get(trackId) ?? []
          for (const event of index.eventsByTrack.get(trackId) ?? []) {
            const effectiveTrack = nativeTrackAtTime(track, controls, event.timeSeconds)
            const previousEnd = previousEndByTrack.get(trackId)
            const legatoFromPrevious = event.articulation === "legato" && previousEnd !== undefined && event.timeSeconds - previousEnd <= 0.08
            realtimeTasks.push({
              timeSeconds: event.timeSeconds,
              run: () => {
                for (const midi of event.notes) schedulePhysicalReedVoice(context, model, { startAt, event, track: effectiveTrack, midi, destination, controls, legatoFromPrevious })
              },
            })
            naturalEnd = Math.max(naturalEnd, event.timeSeconds + event.durationSeconds + 2)
            previousEndByTrack.set(trackId, event.timeSeconds + event.durationSeconds)
          }
        }
      }

      const lookahead = new NativeRealtimeLookahead(realtimeTasks)
      await Promise.all(lookahead.pump(0))
      const fadeSeconds = Math.max(0.08, Math.min(0.35, cue.crossfadeSeconds || 0.12))
      output.gain.setValueAtTime(0, startAt); output.gain.linearRampToValueAtTime(this.targetVolume(), startAt + fadeSeconds)
      await context.resume()

      const pump = () => {
        if (this.context !== context) return
        const pending = lookahead.pump(context.currentTime - startAt)
        for (const promise of pending) promise.catch(error => {
          if (this.context !== context) return
          console.error("Tloque realtime lookahead scheduling failed:", error)
          this.stopRuntime(); this.listener("error", cue)
        })
        if (lookahead.complete) { window.clearInterval(this.schedulerTimer); this.schedulerTimer = 0 }
      }
      if (!lookahead.complete) this.schedulerTimer = window.setInterval(pump, NATIVE_REALTIME_TICK_MS)
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
  private stopRuntime() {
    window.clearTimeout(this.completionTimer); this.completionTimer = 0
    window.clearInterval(this.schedulerTimer); this.schedulerTimer = 0
    this.output?.disconnect(); this.output = null
    if (this.context) void this.context.close(); this.context = null
  }
}
