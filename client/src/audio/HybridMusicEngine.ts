import { linearScoreRecipeFor } from "@shared/audio"
import { instrumentManifestById } from "@shared/instrument-manifest"
import { MusicEngine, type MusicCue, type MusicState } from "./MusicEngine"
import type { MusicBrainScoreV1 } from "@shared/music-brain"
import { LinearScoreEngine } from "./LinearScoreEngine"
import { NativeSampleScoreEngine } from "./NativeSampleScoreEngine"
import { ProceduralMusicEngine } from "./ProceduralMusicEngine"
import { SoundFontMusicEngine } from "./SoundFontMusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void
type Engine = Pick<MusicEngine, "play" | "pause" | "resume" | "stop" | "dispose" | "setMasterVolume" | "setDucked" | "setNarrativeDirection">

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
    if (cue.sourceType === "score" && !cue.instrumentManifestId) {
      try {
        const recipe = linearScoreRecipeFor(cue.recipe)
        if (recipe.version === 2 && recipe.plan.moduleId !== "builtin") {
          resolvedCue = { ...cue, instrumentManifestId: recipe.plan.moduleId }
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
    const useNativeSamples = Boolean(nativeManifest && nativeManifest.id !== "gm-orchestral-strings" && !resolvedCue.packUrl)
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
