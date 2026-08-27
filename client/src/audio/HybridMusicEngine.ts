import { linearScoreRecipeFor, type LinearScoreRecipe } from "@shared/audio"
import { instrumentManifestById } from "@shared/instrument-manifest"
import { nativePhysicalModelByModuleId } from "@shared/native-acoustic-source"
import { MusicEngine, type MusicCue, type MusicState } from "./MusicEngine"
import type { MusicBrainScoreV1 } from "@shared/music-brain"
import { renderMusicBrainRegion } from "@shared/music-brain-renderer"
import { LinearScoreEngine } from "./LinearScoreEngine"
import { NativeSampleScoreEngine } from "./NativeSampleScoreEngine"
import { ProceduralMusicEngine } from "./ProceduralMusicEngine"
import { SoundFontMusicEngine } from "./SoundFontMusicEngine"
import { nativeModuleGroupsForRecipe, NATIVE_AUTO_MODULE_ID } from "./NativeAutoModule"

type Listener = (state: MusicState, cue: MusicCue | null) => void
type Engine = Pick<MusicEngine, "play" | "pause" | "resume" | "stop" | "dispose" | "setMasterVolume" | "setDucked" | "setNarrativeDirection">

async function nativeAcousticSourcesAvailable(recipe: LinearScoreRecipe): Promise<boolean> {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return false
  try {
    const groups = nativeModuleGroupsForRecipe(recipe)
    if (!groups.length) return false
    const available = await Promise.all(groups.map(async group => {
      if (nativePhysicalModelByModuleId(group.moduleId)) return true
      const response = await fetch(
        `/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`,
        { credentials: "include", cache: "no-store" },
      )
      if (!response.ok) return false
      const manifest = await response.json().catch(() => null) as { instrumentManifestId?: unknown } | null
      return Boolean(manifest && manifest.instrumentManifestId === group.moduleId)
    }))
    return available.every(Boolean)
  } catch {
    return false
  }
}

export class HybridMusicEngine {
  private readonly stream: MusicEngine
  private readonly procedural: ProceduralMusicEngine
  private readonly soundfont: SoundFontMusicEngine
  private readonly score: LinearScoreEngine
  private readonly nativeScore: NativeSampleScoreEngine
  private active: Engine | null = null
  private master = 0.35
  private ducked = false
  private state: MusicState = "idle"
  private narrativeScore: MusicBrainScoreV1 | null = null
  private narrativeCue: MusicCue | null = null
  private renderedRegionId: string | null = null
  private direction: { intensity: number; silence: boolean; seconds: number; regionId?: string } = {
    intensity: 0,
    silence: false,
    seconds: 1,
  }
  private playbackToken = 0
  private playbackQueue: Promise<void> = Promise.resolve()
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
    this.nativeScore = new NativeSampleScoreEngine(report)
  }

  async play(cue: MusicCue): Promise<void> {
    const token = ++this.playbackToken
    if (cue.sourceType === "procedural" && this.narrativeScore) {
      this.narrativeCue = cue
      const rendered = renderMusicBrainRegion(this.narrativeScore, this.direction.regionId)
      if (rendered.recipe) {
        this.renderedRegionId = rendered.regionId
        await this.enqueuePlayback({ ...cue, sourceType: "score", recipe: rendered.recipe, loop: true }, token)
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
          nativeAuto = recipe.plan.moduleId === NATIVE_AUTO_MODULE_ID
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

    // `native-auto` may mix installed sample packs and Tloque physical models.
    // A physical model is self-contained; sample-backed groups still prove that
    // their published package can be fully read before the acoustic renderer wins.
    if (useNativeAcoustic && scoreRecipe) {
      useNativeAcoustic = await nativeAcousticSourcesAvailable(scoreRecipe)
    }
    if (token !== this.playbackToken) return

    const needsWorklet = resolvedCue.sourceType === "soundfont"
      || (resolvedCue.sourceType === "score" && Boolean(resolvedCue.packUrl) && !useNativeAcoustic)
    const canUseRequestedEngine = Boolean(AudioContextClass)
      && (!needsWorklet || Boolean(AudioContextClass && "audioWorklet" in AudioContextClass.prototype))
    if (resolvedCue.sourceType !== "stream" && !canUseRequestedEngine) {
      if (resolvedCue.url) {
        await this.play({ ...resolvedCue, sourceType: "stream" })
        return
      }
      this.listener("error", resolvedCue)
      return
    }

    const next: Engine = resolvedCue.sourceType === "procedural"
      ? this.procedural
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
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, regionId?: string) {
    this.direction = { intensity, silence, seconds, regionId }
    this.active?.setNarrativeDirection(intensity, silence, seconds, regionId)
    if (!silence && regionId && regionId !== this.renderedRegionId && this.narrativeCue && this.narrativeScore
      && (this.state === "playing" || this.state === "crossfading")) {
      void this.playNarrativeRegion()
    }
  }
  pause() { this.active?.pause() }
  async resume() {
    await this.active?.resume()
    if (!this.direction.silence && this.direction.regionId !== this.renderedRegionId && this.narrativeCue && this.narrativeScore) {
      await this.playNarrativeRegion()
    }
  }
  stop() {
    this.playbackToken += 1
    this.active?.stop()
    this.active = null
    this.narrativeCue = null
    this.renderedRegionId = null
  }
  dispose() {
    this.stream.dispose()
    this.procedural.dispose()
    this.soundfont.dispose()
    this.score.dispose()
    this.nativeScore.dispose()
    this.active = null
  }

  private async playNarrativeRegion() {
    if (!this.narrativeCue || !this.narrativeScore) return
    const rendered = renderMusicBrainRegion(this.narrativeScore, this.direction.regionId)
    if (!rendered.recipe || rendered.regionId === this.renderedRegionId) return
    const token = ++this.playbackToken
    this.renderedRegionId = rendered.regionId
    await this.enqueuePlayback({
      ...this.narrativeCue,
      sourceType: "score",
      recipe: rendered.recipe,
      loop: true,
      crossfadeSeconds: Math.max(this.narrativeCue.crossfadeSeconds, this.direction.seconds),
    }, token)
  }

  private enqueuePlayback(cue: MusicCue, token: number): Promise<void> {
    const task = this.playbackQueue.then(() => this.playResolved(cue, token))
    this.playbackQueue = task.catch(() => undefined)
    return task
  }
}
