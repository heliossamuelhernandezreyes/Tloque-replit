import { linearScoreRecipeFor } from "@shared/audio"
import { ORCHESTRAL_SYNTH_MODULE_ID } from "@shared/orchestral-synthesis"
import { nativePhysicalModelByModuleId } from "@shared/native-acoustic-source"
import { hybridSourceMasterApproved } from "@shared/native-hybrid-approval-registry"
import { buildNativeHybridPerformancePlan } from "@shared/native-hybrid-performance"
import { scheduleHybridPhysicalOverlay } from "./HybridPhysicalOverlay"
import type { MusicCue, MusicState } from "./MusicEngine"
import { nativeModuleGroupsForRecipe, recipeForNativeModule, type NativeModuleGroup } from "./NativeAutoModule"
import { buildNativeProgressivePreloadPlan } from "./NativeProgressivePreload"
import { buildNativeRecipeIndex, nativeTrackAtTime } from "./NativeRecipeIndex"
import { NativeRealtimeLookahead, NATIVE_REALTIME_LOOKAHEAD_SECONDS, NATIVE_REALTIME_TICK_MS, type NativeRealtimeTask } from "./NativeRealtimeLookahead"
import { createNativeRenderGraph } from "./NativeRenderGraph"
import { NativeSamplePackPlayer } from "./NativeSamplePackEngine"
import { buildNativeSampleScorePlan, type NativeSampleScorePlan } from "./NativeSampleScorePlan"
import { schedulePhysicalReedVoice } from "./PhysicalReedModel"
import {
  scoreTrackExpression,
  scoreTrackTimbre,
  scoreMonitorVolume,
} from "./ScoreAudioMath"
import { scheduleFallbackSynthVoice } from "./FallbackScoreSynth"
import { scheduleOrchestralSynthVoice } from "./OrchestralSynthVoice"
import { buildOrchestralSynthPlan } from "./OrchestralSynthPlan"
import { buildPerformedRecipeV2 } from "./PerformanceEngine"

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

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function dwellGain(cue: MusicCue, role: string, cycleOffset: number, cycleSeconds: number, eventKey: string) {
  if (!cue.adaptiveDwell || cycleSeconds <= 0) return 1
  const cycle = Math.max(0, Math.floor((cycleOffset + 0.001) / cycleSeconds))
  if (cycle === 0) return 1
  const keep = (stride: number) => stableHash(`${eventKey}:${cycle}`) % stride === 0
  if (cycle === 1) return role === "pulse" ? (keep(2) ? 0.94 : 0) : 0.94
  if (cycle < 4) {
    if (role === "pulse") return keep(3) ? 0.82 : 0
    if (role === "melody") return keep(2) ? 0.82 : 0
    return 0.82
  }
  if (role === "pulse" || role === "melody") return 0
  return 0.68
}

export class NativeSampleScoreEngine {
  private context: AudioContext | null = null
  private cue: MusicCue | null = null
  private output: GainNode | null = null
  private schedulerTimer = 0
  private startAtSeconds = 0
  private barSeconds = 0
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1
  private playToken = 0

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue, startDelay?: () => number): Promise<number> {
    const playToken = ++this.playToken
    this.listener("loading", cue)
    this.stopRuntime()
    try {
      const recipe = linearScoreRecipeFor(cue.recipe)
      if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") throw new Error("La partitura no solicita fuentes acústicas nativas")
      const context = createRealtimeAudioContext()
      const orchestralSynthesis = recipe.plan.moduleId === ORCHESTRAL_SYNTH_MODULE_ID
      const groups = orchestralSynthesis ? [] : nativeModuleGroupsForRecipe(recipe)
      const sampleGroups: NativeModuleGroup[] = [], physicalGroups: NativeModuleGroup[] = []
      for (const group of groups) (nativePhysicalModelByModuleId(group.moduleId) ? physicalGroups : sampleGroups).push(group)

      const loaded: LoadedNativePlan[] = []
      const fallbackTrackIds = new Set<string>(orchestralSynthesis ? recipe.plan.tracks.map(track => track.id) : [])
      for (const group of sampleGroups) {
        try {
          const player = new NativeSamplePackPlayer(context)
          const packUrl = `/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`
          const pack = await player.loadPack(packUrl)
          if (playToken !== this.playToken) { void context.close(); return 0 }
          if (pack.instrumentManifestId !== group.moduleId) throw new Error(`El paquete nativo ${group.moduleId} no corresponde a su manifest`)
          const plan = buildNativeSampleScorePlan(recipeForNativeModule(recipe, group), pack)
          loaded.push({ moduleId: group.moduleId, plan, player })
        } catch (error) {
          group.trackIds.forEach(trackId => fallbackTrackIds.add(trackId))
          console.warn(`Tloque native module ${group.moduleId} unavailable; using per-track fallback`, error)
        }
      }

      if (playToken !== this.playToken) { void context.close(); return 0 }

      const index = buildNativeRecipeIndex(recipe)
      const { performance: universalPerformance, recipe: performedRecipe } = buildPerformedRecipeV2(recipe)
      const performedByOriginal = new Map(recipe.plan.events.map((event, eventIndex) => [event, performedRecipe.plan.events[eventIndex]] as const))
      const decisionByOriginal = new Map(recipe.plan.events.map((event, eventIndex) => [event, universalPerformance.decisionForEvent(eventIndex)] as const))
      const hybridPerformance = buildNativeHybridPerformancePlan(performedRecipe)
      const graph = createNativeRenderGraph(context, index.trackById)
      const output = context.createGain(); output.gain.value = 0; graph.output.connect(output); output.connect(context.destination)

      for (const { plan } of loaded) for (const track of plan.tracks) graph.createTrackPath(track.id, track.gain, track.brightness, track.pan)
      for (const group of physicalGroups) for (const trackId of group.trackIds) {
        const track = index.trackById.get(trackId)
        if (track) graph.createTrackPath(track.id, track.gain * track.expression, track.brightness, track.pan)
      }
      for (const trackId of fallbackTrackIds) {
        const track = index.trackById.get(trackId)
        if (!track) continue
        const timbre = scoreTrackTimbre(track)
        graph.createTrackPath(track.id, track.gain * timbre.level * scoreTrackExpression(track), track.brightness, track.pan)
      }

      if (context.state === "running") await context.suspend()
      const fallbackInstruments = [...new Set([...fallbackTrackIds]
        .map(trackId => index.trackById.get(trackId)?.instrument)
        .filter((value): value is string => Boolean(value)))]
      let runtimeCue: MusicCue = {
        ...cue,
        playbackTier: fallbackTrackIds.size === 0 ? "native" : fallbackTrackIds.size < recipe.plan.tracks.length ? "hybrid" : "synth",
        fallbackInstrumentIds: orchestralSynthesis ? [] : fallbackInstruments,
        orchestralSynthesis,
      }
      this.context = context; this.output = output; this.cue = runtimeCue
      const markFallback = (trackId: string, error: unknown) => {
        fallbackTrackIds.add(trackId)
        const fallbackInstrumentIds = [...new Set([...fallbackTrackIds]
          .map(id => index.trackById.get(id)?.instrument)
          .filter((value): value is string => Boolean(value)))]
        runtimeCue = {
          ...runtimeCue,
          playbackTier: fallbackTrackIds.size < recipe.plan.tracks.length ? "hybrid" : "synth",
          fallbackInstrumentIds,
        }
        this.cue = runtimeCue
        console.warn(`Tloque native track ${trackId} degraded after sample fetch/decode failure`, error)
        if (this.context === context && context.state === "running") this.listener("playing", runtimeCue)
      }
      const boundaryDelay = Math.max(0, Math.min(4, startDelay?.() ?? 0))
      const startAt = context.currentTime + 0.12 + boundaryDelay
      this.startAtSeconds = startAt
      this.barSeconds = 60 / recipe.plan.bpm * recipe.plan.meter.numerator
      let naturalEnd = recipe.plan.totalSeconds
      const realtimeTasks: NativeRealtimeTask[] = []
      const shouldLoop = cue.loop && recipe.plan.loop

      for (const { plan, player } of loaded) {
        for (const control of plan.controls) realtimeTasks.push({
          timeSeconds: control.timeSeconds,
          run: (cycleOffset = 0) => graph.scheduleTrackControl(control, startAt + cycleOffset),
        })
        const zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))

        // Warm each physical WAV before first use, then drop the player's retained
        // decode after the final use. Release tasks are offset by the look-ahead
        // horizon because NativeRealtimeLookahead executes tasks ahead of their
        // timestamp; this makes the actual deletion happen no earlier than
        // releaseAtSeconds. AudioBufferSourceNodes already scheduled keep their own
        // AudioBuffer reference, so deleting the player's cache does not cut sound.
        for (const preload of buildNativeProgressivePreloadPlan(plan)) {
          realtimeTasks.push({
            timeSeconds: preload.preloadAtSeconds,
            run: async () => { await player.preload([preload.zone]).catch(() => undefined) },
          })
          if (!shouldLoop) realtimeTasks.push({
            timeSeconds: preload.releaseAtSeconds + NATIVE_REALTIME_LOOKAHEAD_SECONDS,
            run: () => { player.releaseSample(preload.zone.sampleUrl) },
          })
        }

        for (const voice of plan.voices) {
          const destination = graph.trackGain.get(voice.trackId), zone = zoneById.get(voice.zoneId), semanticTrack = index.trackById.get(voice.trackId)
          if (!destination || !zone) continue
          realtimeTasks.push({
            timeSeconds: voice.startSeconds,
            run: (cycleOffset = 0) => {
              const scale = dwellGain(cue, semanticTrack?.role ?? "harmony", cycleOffset, recipe.plan.totalSeconds, `${voice.trackId}:${voice.startSeconds}:${voice.note}`)
              if (scale <= 0) return
              return player.playSelection(
                { zone, playbackRate: voice.playbackRate, gain: voice.sampleGain * scale },
                startAt + cycleOffset + voice.startSeconds,
                voice.durationSeconds,
                destination,
                0,
                voice.oneShot,
                { ...(voice.fadeInSeconds > 0 ? { fadeInSeconds: voice.fadeInSeconds } : {}), expression: voice.expression, dynamics: voice.dynamics },
              ).catch(error => {
                if (!semanticTrack || this.context !== context) return null
                markFallback(voice.trackId, error)
                scheduleFallbackSynthVoice(context, destination, startAt + cycleOffset, {
                  timeSeconds: voice.startSeconds,
                  durationSeconds: voice.durationSeconds,
                  notes: [voice.note],
                  velocity: Math.max(0.01, Math.min(1, voice.velocity / 127)) * scale,
                  articulation: voice.articulation,
                  timbre: voice.timbre,
                  durationIsPerformed: true,
                }, semanticTrack)
                return null
              })
            },
          })
          if (voice.oneShot) naturalEnd = Math.max(naturalEnd, voice.startSeconds + Math.max(voice.durationSeconds, 8))
        }
        for (const auxiliary of plan.auxiliaryVoices) {
          const destination = graph.trackGain.get(auxiliary.trackId), zone = zoneById.get(auxiliary.zoneId)
          if (!destination || !zone) continue
          realtimeTasks.push({
            timeSeconds: auxiliary.startSeconds,
            run: (cycleOffset = 0) => player.playSelection(
              { zone, playbackRate: auxiliary.playbackRate, gain: auxiliary.sampleGain },
              startAt + cycleOffset + auxiliary.startSeconds,
              auxiliary.durationSeconds,
              destination,
              0,
              true,
              auxiliary.fadeOutSeconds > 0 ? { fadeOutSeconds: auxiliary.fadeOutSeconds } : undefined,
            ).catch(error => { console.warn("Tloque native release/transition sample unavailable", error); return null }),
          })
          naturalEnd = Math.max(naturalEnd, auxiliary.startSeconds + Math.max(auxiliary.durationSeconds, 2))
        }
      }

      for (const decision of hybridPerformance.decisions) {
        const { event, source: hybrid } = decision
        const track = index.trackById.get(event.trackId), destination = graph.trackGain.get(event.trackId)
        if (!track || !destination || fallbackTrackIds.has(event.trackId) || (recipe.plan.quality === "master" && !hybridSourceMasterApproved(hybrid))) continue
        const controls = index.controlsByTrack.get(event.trackId) ?? []
        const effectiveTrack = nativeTrackAtTime(track, controls, event.timeSeconds)
        realtimeTasks.push({
          timeSeconds: event.timeSeconds,
          run: (cycleOffset = 0) => {
            const scale = dwellGain(cue, track.role, cycleOffset, recipe.plan.totalSeconds, `${event.trackId}:${event.timeSeconds}`)
            if (scale <= 0) return
            for (const midi of decision.midis) scheduleHybridPhysicalOverlay(context, hybrid, { startAt: startAt + cycleOffset, event, track: { ...effectiveTrack, expression: effectiveTrack.expression * scale }, midi, destination, controls, legatoFromPrevious: decision.legatoFromPrevious, performance: decision })
          },
        })
        naturalEnd = Math.max(naturalEnd, event.timeSeconds + event.durationSeconds + 7)
      }

      for (const group of physicalGroups) {
        const model = nativePhysicalModelByModuleId(group.moduleId)
        if (!model) continue
        for (const trackId of group.trackIds) {
          const track = index.trackById.get(trackId)
          if (!track) continue
          for (const control of index.controlsByTrack.get(trackId) ?? []) realtimeTasks.push({
            timeSeconds: control.timeSeconds,
            run: (cycleOffset = 0) => graph.scheduleTrackControl({
              trackId,
              timeSeconds: control.timeSeconds,
              rampSeconds: control.rampSeconds,
              gain: control.expression === null ? null : track.gain * control.expression,
              brightness: control.brightness,
            }, startAt + cycleOffset),
          })
        }

        const previousByTrack = new Map<string, (typeof recipe.plan.events)[number]>()
        for (const trackId of group.trackIds) {
          const track = index.trackById.get(trackId), destination = graph.trackGain.get(trackId)
          if (!track || !destination) continue
          const controls = index.controlsByTrack.get(trackId) ?? []
          for (const authoredEvent of index.eventsByTrack.get(trackId) ?? []) {
            const event = performedByOriginal.get(authoredEvent) ?? authoredEvent
            const directorDecision = decisionByOriginal.get(authoredEvent)
            const effectiveTrack = nativeTrackAtTime(track, controls, event.timeSeconds)
            const previous = previousByTrack.get(trackId)
            const authoredGap = previous ? authoredEvent.timeSeconds - (previous.timeSeconds + previous.durationSeconds) : Number.POSITIVE_INFINITY
            const legatoFromPrevious = Boolean(
              event.articulation === "legato"
              && directorDecision
              && !directorDecision.phraseStart
              && previous?.notes.length === 1
              && authoredEvent.notes.length === 1
              && previous.notes[0] !== authoredEvent.notes[0]
              && Math.abs(previous.notes[0] - authoredEvent.notes[0]) <= 12
              && authoredGap >= -0.12
              && authoredGap <= 0.08,
            )
            realtimeTasks.push({
              timeSeconds: event.timeSeconds,
              run: (cycleOffset = 0) => {
                const scale = dwellGain(cue, track.role, cycleOffset, recipe.plan.totalSeconds, `${event.trackId}:${event.timeSeconds}`)
                if (scale <= 0) return
                for (const midi of event.notes) schedulePhysicalReedVoice(context, model, { startAt: startAt + cycleOffset, event, track: { ...effectiveTrack, expression: effectiveTrack.expression * scale }, midi, destination, controls, legatoFromPrevious })
              },
            })
            naturalEnd = Math.max(naturalEnd, event.timeSeconds + event.durationSeconds + 2)
            previousByTrack.set(trackId, authoredEvent)
          }
        }
      }

      for (const trackId of fallbackTrackIds) {
        const track = index.trackById.get(trackId), destination = graph.trackGain.get(trackId)
        if (!track || !destination) continue
        for (const control of index.controlsByTrack.get(trackId) ?? []) realtimeTasks.push({
          timeSeconds: control.timeSeconds,
          run: (cycleOffset = 0) => graph.scheduleTrackControl({
            trackId,
            timeSeconds: control.timeSeconds,
            rampSeconds: control.rampSeconds,
            gain: control.expression === null ? null : track.gain * scoreTrackTimbre(track).level * control.expression,
            brightness: control.brightness,
          }, startAt + cycleOffset),
        })
      }
      for (const event of buildOrchestralSynthPlan(recipe, fallbackTrackIds)) {
        const track = index.trackById.get(event.trackId), destination = graph.trackGain.get(event.trackId)
        if (!track || !destination) continue
        const controls = index.controlsByTrack.get(event.trackId) ?? []
        realtimeTasks.push({
          timeSeconds: event.timeSeconds,
          run: (cycleOffset = 0) => {
            const scale = dwellGain(cue, track.role, cycleOffset, recipe.plan.totalSeconds, `${event.trackId}:${event.timeSeconds}`)
            if (scale <= 0) return
            const count = scheduleOrchestralSynthVoice(context, destination, startAt + cycleOffset, { ...event, velocity: event.velocity * scale }, track, orchestralSynthesis ? 1 : 0.72, controls)
            if (count < event.notes.length) throw new Error("La orquesta supera el presupuesto de voces; reduce acordes simultáneos o divide la obra por secciones")
          },
        })
        naturalEnd = Math.max(naturalEnd, event.timeSeconds + event.durationSeconds + 6)
      }

      const lookahead = new NativeRealtimeLookahead(realtimeTasks, shouldLoop ? recipe.plan.totalSeconds : 0)
      await Promise.all(lookahead.pump(0))
      if (playToken !== this.playToken) { this.stopRuntime(); return 0 }
      const fadeSeconds = Math.max(0.08, Math.min(20, cue.crossfadeSeconds || 0.12))
      output.gain.setValueAtTime(0, startAt); output.gain.linearRampToValueAtTime(this.targetVolume(), startAt + fadeSeconds)
      await context.resume()
      if (playToken !== this.playToken) { this.stopRuntime(); return 0 }

      const pump = () => {
        if (this.context !== context) return
        const elapsed = context.currentTime - startAt
        const pending = lookahead.pump(elapsed)
        for (const promise of pending) promise.catch(error => {
          if (this.context !== context) return
          console.error("Tloque realtime lookahead scheduling failed:", error)
          this.stopRuntime(); this.listener("error", cue)
        })
        if (!shouldLoop && elapsed >= naturalEnd + 0.5) {
          window.clearInterval(this.schedulerTimer); this.schedulerTimer = 0
          this.listener("paused", this.cue)
        }
      }
      this.schedulerTimer = window.setInterval(pump, NATIVE_REALTIME_TICK_MS)
      this.listener("playing", runtimeCue)
      return Math.max(0, startAt - context.currentTime)
    } catch (error) {
      if (playToken !== this.playToken) return 0
      console.error("Tloque native acoustic playback failed:", error)
      this.stopRuntime(); this.listener("error", cue)
      return 0
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    if (this.context && this.output) { const now = this.context.currentTime; this.output.gain.cancelScheduledValues(now); this.output.gain.linearRampToValueAtTime(this.targetVolume(), now + Math.max(0.25, seconds)) }
  }
  secondsUntilNextBar(maxWaitSeconds = 4) {
    if (!this.context || this.barSeconds <= 0 || this.startAtSeconds <= 0) return 0
    const elapsed = Math.max(0, this.context.currentTime - this.startAtSeconds)
    const next = Math.ceil((elapsed + 0.04) / this.barSeconds) * this.barSeconds
    return Math.max(0, Math.min(maxWaitSeconds, next - elapsed))
  }
  fadeOutAndStop(seconds: number, delaySeconds = 0) {
    const context = this.context, output = this.output
    if (!context || !output) { this.stopRuntime(); return }
    const duration = Math.max(0.08, Math.min(20, seconds))
    const delay = Math.max(0, Math.min(4, delaySeconds))
    const now = context.currentTime
    const begins = now + delay
    output.gain.cancelScheduledValues(begins)
    output.gain.setValueAtTime(Math.max(0.0001, output.gain.value), begins)
    output.gain.exponentialRampToValueAtTime(0.0001, begins + duration)
    window.setTimeout(() => {
      if (this.context === context) this.stopRuntime()
    }, (delay + duration + 0.15) * 1_000)
  }
  pause() { if (this.context) void this.context.suspend(); this.listener("paused", this.cue) }
  async resume() { if (this.context) await this.context.resume(); if (this.cue) this.listener("playing", this.cue) }
  stop() { this.playToken += 1; this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }
  private targetVolume() { return scoreMonitorVolume(this.master, this.cue?.volume ?? 1, this.duckFactor, this.narrativeGain, this.cue?.monitoring === "reference") }
  private applyVolume() { if (!this.context || !this.output) return; const now = this.context.currentTime; this.output.gain.cancelScheduledValues(now); this.output.gain.linearRampToValueAtTime(this.targetVolume(), now + 0.18) }
  private stopRuntime() {
    window.clearInterval(this.schedulerTimer); this.schedulerTimer = 0
    this.output?.disconnect(); this.output = null
    if (this.context) void this.context.close(); this.context = null
    this.startAtSeconds = 0
    this.barSeconds = 0
  }
}
