import { linearScoreRecipeFor, type LinearScoreRecipe } from "@shared/audio"
import { instrumentManifestById } from "@shared/instrument-manifest"
import { MusicEngine, type MusicCue, type MusicState } from "./MusicEngine"
import type { MusicBrainScoreV1 } from "@shared/music-brain"
import { LinearScoreEngine } from "./LinearScoreEngine"
import { NativeSampleScoreEngine } from "./NativeSampleScoreEngine"
import { ProceduralMusicEngine } from "./ProceduralMusicEngine"
import { SoundFontMusicEngine } from "./SoundFontMusicEngine"
import { nativeModuleGroupsForRecipe, NATIVE_AUTO_MODULE_ID } from "./NativeAutoModule"

type Listener = (state: MusicState, cue: MusicCue | null) => void
type Engine = Pick<MusicEngine, "play" | "pause" | "resume" | "stop" | "dispose" | "setMasterVolume" | "setDucked" | "setNarrativeDirection">

async function nativeSamplePacksAvailable(recipe: LinearScoreRecipe): Promise<boolean> {
  if (recipe.version !== 2 || recipe.plan.moduleId === "builtin") return false
  try {
    const groups = nativeModuleGroupsForRecipe(recipe)
    if (!groups.length) return false
    const available = await Promise.all(groups.map(async group => {
      const response = await fetch(
        `/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`,
        { credentials: "include", cache: "no-store" },
      )
      if (!response.ok) return false
      // Consume and parse the body. The App Storage route can emit a streaming
      // failure after headers have been created, so a HEAD/response.ok-only probe
      // is not sufficient proof that the package physically exists.
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
  private readonly listener: Listener

  constructor(listener: Listener) {
    this.listener = listener
    this.stream = new MusicEngine(listener)
    this.procedural = new ProceduralMusicEngine(listener)
    this.soundfont = new SoundFontMusicEngine(listener)
    this.score = new LinearScoreEngine(listener)
    this.nativeScore = new NativeSampleScoreEngine(listener)
  }

  async play(cue: MusicCue): Promise<void> {
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
    let useNativeSamples = resolvedCue.sourceType === "score"
      && (nativeAuto || Boolean(nativeManifest && nativeManifest.id !== "gm-orchestral-strings" && !resolvedCue.packUrl))

    // `native-auto` is a virtual routing module: every semantic instrument may
    // require a different installed sample pack. If even one package is absent,
    // preview must honor the Studio promise and fall back to Tloque's base
    // synthesis instead of ending in a silent 404/error state.
    if (useNativeSamples && scoreRecipe) {
      useNativeSamples = await nativeSamplePacksAvailable(scoreRecipe)
    }

    const needsWorklet = resolvedCue.sourceType === "soundfont"
      || (resolvedCue.sourceType === "score" && Boolean(resolvedCue.packUrl) && !useNativeSamples)
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
        : resolvedCue.sourceType === "score" ? (useNativeSamples ? this.nativeScore : this.score)
          : this.stream
    if (this.active && this.active !== next) this.active.stop()
    this.active = next
    next.setMasterVolume(this.master)
    next.setDucked(this.ducked)
    await next.play(resolvedCue)
  }
  setMasterVolume(value: number) { this.master = value; this.active?.setMasterVolume(value) }
  setDucked(value: boolean) { this.ducked = value; this.active?.setDucked(value) }
  setNarrativeScore(score: MusicBrainScoreV1 | null) { this.procedural.setNarrativeScore(score) }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, regionId?: string) { this.active?.setNarrativeDirection(intensity, silence, seconds, regionId) }
  pause() { this.active?.pause() }
  async resume() { await this.active?.resume() }
  stop() { this.active?.stop(); this.active = null }
  dispose() {
    this.stream.dispose()
    this.procedural.dispose()
    this.soundfont.dispose()
    this.score.dispose()
    this.nativeScore.dispose()
    this.active = null
  }
}
