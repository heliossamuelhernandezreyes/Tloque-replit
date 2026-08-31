import { linearScoreRecipeFor, type LinearScoreRecipe } from "@shared/audio"
import { instrumentManifestById } from "@shared/instrument-manifest"
import { MusicEngine, type MusicCue, type MusicState } from "./MusicEngine"
import type { MusicBrainAudioLayer, MusicBrainScoreV1 } from "@shared/music-brain"
import { renderMusicBrainRegion } from "@shared/music-brain-renderer"
import { LinearScoreEngine } from "./LinearScoreEngine"
import { NativeCrossfadeScoreEngine } from "./NativeCrossfadeScoreEngine"
import { ProceduralMusicEngine } from "./ProceduralMusicEngine"
import { SoundFontMusicEngine } from "./SoundFontMusicEngine"
import { NATIVE_AUTO_MODULE_ID } from "./NativeAutoModule"
import { AdaptiveLayerMusicEngine } from "./AdaptiveLayerMusicEngine"
import { adaptiveLayersForRegion } from "./AdaptiveScoreLayers"
import { ORCHESTRAL_SYNTH_MODULE_ID } from "@shared/orchestral-synthesis"

type Listener = (state: MusicState, cue: MusicCue | null) => void
type Engine = Pick<MusicEngine, "play" | "pause" | "resume" | "stop" | "dispose" | "setMasterVolume" | "setDucked" | "setNarrativeDirection">

export class HybridMusicEngine {
  private readonly stream: MusicEngine
  private readonly procedural: ProceduralMusicEngine
  private readonly soundfont: SoundFontMusicEngine
  private readonly score: LinearScoreEngine
  private readonly nativeScore: NativeCrossfadeScoreEngine
  private readonly adaptive: AdaptiveLayerMusicEngine
  private active: Engine | null = null
  private master = 0.35
  private ducked = false
  private state: MusicState = "idle"
  private narrativeScore: MusicBrainScoreV1 | null = null
  private adaptiveLayers: readonly MusicBrainAudioLayer[] = []
  private narrativeCue: MusicCue | null = null
  private renderedRegionId: string | null = null
  private direction: { intensity: number; silence: boolean; seconds: number; regionId?: string } = {
    intensity: 0,
    silence: false,
    seconds: 1,
  }
  private playbackToken = 0
  private playbackQueue: Promise<void> = Promise.resolve()
  private silenceTimer = 0
  private readonly listener: Listener

  constructor(listener: Listener) {
    this.listener = listener
    const report: Listener = (state, cue) => {
      this.state = state
      this.listener(state, cue)
    }
    this.stream = new MusicEngine(report)
    this.procedural = new ProceduralMusicEngine(report)
    this.soundfont = new SoundFontMusicEngine(report)
    this.score = new LinearScoreEngine(report)
    this.nativeScore = new NativeCrossfadeScoreEngine(report)
    this.adaptive = new AdaptiveLayerMusicEngine(report)
  }

  async play(cue: MusicCue): Promise<void> {
    const token = ++this.playbackToken
    if (cue.sourceType === "procedural" && this.narrativeScore) {
      this.narrativeCue = cue
      const rendered = renderMusicBrainRegion(this.narrativeScore, this.direction.regionId)
      const adaptiveLayers = adaptiveLayersForRegion(this.narrativeScore, this.adaptiveLayers, rendered.regionId)
      if (!rendered.silence && adaptiveLayers.length) {
        this.renderedRegionId = rendered.regionId
        await this.enqueuePlayback({ ...cue, sourceType: "adaptive", adaptiveLayers, loop: true }, token)
        return
      }
      if (rendered.recipe) {
        this.renderedRegionId = rendered.regionId
        await this.enqueuePlayback({ ...cue, sourceType: "score", recipe: rendered.recipe, loop: true, adaptiveDwell: true }, token)
        return
      }
      if (rendered.silence) {
        this.renderedRegionId = rendered.regionId
        this.active?.stop()
        this.active = null
        this.state = "playing"
        this.listener("playing", cue)
        return
      }
    } else {
      this.narrativeCue = null
      this.renderedRegionId = null
    }
    await this.enqueuePlayback(cue, token)
  }

  private async playResolved(cue: MusicCue, token: number): Promise<void> {
    if (token !== this.playbackToken) return
    let resolvedCue = cue
    let nativeAuto = false
    let scoreRecipe: LinearScoreRecipe | null = null
    if (cue.sourceType === "score") {
      try {
        const recipe = linearScoreRecipeFor(cue.recipe)
        scoreRecipe = recipe
        if (recipe.version === 2) {
          nativeAuto = recipe.plan.moduleId === NATIVE_AUTO_MODULE_ID || recipe.plan.moduleId === ORCHESTRAL_SYNTH_MODULE_ID
          if (recipe.plan.moduleId !== "builtin" && !nativeAuto && !cue.instrumentManifestId) {
            resolvedCue = { ...cue, instrumentManifestId: recipe.plan.moduleId }
          }
        }
      } catch {
        // The concrete score renderer owns malformed recipe reporting.
      }
    }

    const AudioContextClass = typeof window !== "undefined"
      ? window.AudioContext || (window as any).webkitAudioContext
      : null
    const nativeManifest = resolvedCue.sourceType === "score"
      ? instrumentManifestById(resolvedCue.instrumentManifestId)
      : null
    let useNativeAcoustic = resolvedCue.sourceType === "score"
      && (nativeAuto || Boolean(nativeManifest && nativeManifest.id !== "gm-orchestral-strings" && !resolvedCue.packUrl))

    // The native renderer resolves each track independently. Missing packages
    // use its bounded per-track fallback instead of collapsing the entire score.
    if (useNativeAcoustic && !scoreRecipe) useNativeAcoustic = false

    const needsWorklet = resolvedCue.sourceType === "soundfont"
      || (resolvedCue.sourceType === "score" && Boolean(resolvedCue.packUrl) && !useNativeAcoustic)
    const canUseRequestedEngine = Boolean(AudioContextClass)
      && (!needsWorklet || Boolean(AudioContextClass && "audioWorklet" in AudioContextClass.prototype))
    if (resolvedCue.sourceType !== "stream" && resolvedCue.sourceType !== "adaptive" && !canUseRequestedEngine) {
      if (resolvedCue.url) {
        await this.play({ ...resolvedCue, sourceType: "stream" })
        return
      }
      this.listener("error", resolvedCue)
      return
    }

    const next: Engine = resolvedCue.sourceType === "procedural"
      ? this.procedural
      : resolvedCue.sourceType === "adaptive" ? this.adaptive
      : resolvedCue.sourceType === "soundfont" ? this.soundfont
        : resolvedCue.sourceType === "score" ? (useNativeAcoustic ? this.nativeScore : this.score)
          : this.stream
    if (this.active && this.active !== next) this.active.stop()
    this.active = next
    next.setMasterVolume(this.master)
    next.setDucked(this.ducked)
    await next.play(resolvedCue)
    if (token !== this.playbackToken) return
    next.setNarrativeDirection(
      this.direction.intensity,
      this.direction.silence,
      this.direction.seconds,
      this.direction.regionId,
    )
  }
  setMasterVolume(value: number) { this.master = value; this.active?.setMasterVolume(value) }
  setDucked(value: boolean) { this.ducked = value; this.active?.setDucked(value) }
  setNarrativeScore(score: MusicBrainScoreV1 | null) {
    this.narrativeScore = score
    this.procedural.setNarrativeScore(score)
    if (!score) {
      this.renderedRegionId = null
      return
    }
    if (this.narrativeCue && (this.state === "playing" || this.state === "crossfading")) {
      this.renderedRegionId = null
      void this.playNarrativeRegion()
    }
  }
  setAdaptiveLayers(layers: readonly MusicBrainAudioLayer[]) {
    this.adaptiveLayers = layers
  }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, regionId?: string) {
    this.direction = { intensity, silence, seconds, regionId }
    this.active?.setNarrativeDirection(intensity, silence, seconds, regionId)
    if (silence && regionId && regionId !== this.renderedRegionId && this.narrativeCue && this.narrativeScore
      && (this.state === "playing" || this.state === "crossfading")) {
      this.enterNarrativeSilence(regionId, seconds)
      return
    }
    if (!silence && regionId && regionId !== this.renderedRegionId && this.narrativeCue && this.narrativeScore
      && (this.state === "playing" || this.state === "crossfading")) {
      void this.playNarrativeRegion()
    }
  }
  pause() {
    if (this.active) this.active.pause()
    else if (this.narrativeCue) { this.state = "paused"; this.listener("paused", this.narrativeCue) }
  }
  async resume() {
    await this.active?.resume()
    if (!this.active && this.narrativeCue && this.direction.silence) { this.state = "playing"; this.listener("playing", this.narrativeCue) }
    if (!this.direction.silence && this.direction.regionId !== this.renderedRegionId && this.narrativeCue && this.narrativeScore) {
      await this.playNarrativeRegion()
    }
  }
  stop() {
    this.playbackToken += 1
    window.clearTimeout(this.silenceTimer)
    this.active?.stop()
    this.active = null
    this.narrativeCue = null
    this.renderedRegionId = null
  }
  dispose() {
    window.clearTimeout(this.silenceTimer)
    this.stream.dispose()
    this.procedural.dispose()
    this.soundfont.dispose()
    this.score.dispose()
    this.nativeScore.dispose()
    this.adaptive.dispose()
    this.active = null
  }

  private async playNarrativeRegion() {
    if (!this.narrativeCue || !this.narrativeScore) return
    const rendered = renderMusicBrainRegion(this.narrativeScore, this.direction.regionId)
    if (rendered.regionId === this.renderedRegionId || rendered.silence) return
    const adaptiveLayers = adaptiveLayersForRegion(this.narrativeScore, this.adaptiveLayers, rendered.regionId)
    if (!rendered.recipe && !adaptiveLayers.length) return
    const token = ++this.playbackToken
    this.renderedRegionId = rendered.regionId
    await this.enqueuePlayback({
      ...this.narrativeCue,
      sourceType: adaptiveLayers.length ? "adaptive" : "score",
      recipe: adaptiveLayers.length ? undefined : rendered.recipe,
      adaptiveLayers: adaptiveLayers.length ? adaptiveLayers : undefined,
      loop: true,
      crossfadeSeconds: Math.max(this.narrativeCue.crossfadeSeconds, this.direction.seconds),
      adaptiveDwell: true,
    }, token)
  }

  private enterNarrativeSilence(regionId: string, seconds: number) {
    this.renderedRegionId = regionId
    window.clearTimeout(this.silenceTimer)
    const retiring = this.active
    if (!retiring) {
      this.state = "playing"
      this.listener("playing", this.narrativeCue)
      return
    }
    this.state = "crossfading"
    this.listener("crossfading", this.narrativeCue)
    this.silenceTimer = window.setTimeout(() => {
      if (!this.direction.silence || this.renderedRegionId !== regionId || this.active !== retiring) return
      retiring.stop()
      this.active = null
      this.state = "playing"
      this.listener("playing", this.narrativeCue)
    }, Math.max(0.25, Math.min(30, seconds)) * 1_000)
  }

  private enqueuePlayback(cue: MusicCue, token: number): Promise<void> {
    const task = this.playbackQueue.then(() => this.playResolved(cue, token))
    this.playbackQueue = task.catch(() => undefined)
    return task
  }
}
