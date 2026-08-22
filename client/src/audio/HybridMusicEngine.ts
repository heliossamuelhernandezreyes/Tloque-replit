import { MusicEngine, type MusicCue, type MusicState } from "./MusicEngine"
import type { MusicBrainScoreV1 } from "@shared/music-brain"
import { ProceduralMusicEngine } from "./ProceduralMusicEngine"
import { SoundFontMusicEngine } from "./SoundFontMusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void
type Engine = Pick<MusicEngine, "play" | "pause" | "resume" | "stop" | "dispose" | "setMasterVolume" | "setDucked" | "setNarrativeDirection">

export class HybridMusicEngine {
  private readonly stream: MusicEngine
  private readonly procedural: ProceduralMusicEngine
  private readonly soundfont: SoundFontMusicEngine
  private active: Engine | null = null
  private master = 0.35
  private ducked = false
  private readonly listener: Listener

  constructor(listener: Listener) {
    this.listener = listener
    this.stream = new MusicEngine(listener)
    this.procedural = new ProceduralMusicEngine(listener)
    this.soundfont = new SoundFontMusicEngine(listener)
  }

  async play(cue: MusicCue): Promise<void> {
    const AudioContextClass = typeof window !== "undefined"
      ? window.AudioContext || (window as any).webkitAudioContext
      : null
    const needsWorklet = cue.sourceType === "soundfont"
    const canUseRequestedEngine = Boolean(AudioContextClass)
      && (!needsWorklet || Boolean(AudioContextClass && "audioWorklet" in AudioContextClass.prototype))
    if (cue.sourceType !== "stream" && !canUseRequestedEngine) {
      if (cue.url) {
        await this.play({ ...cue, sourceType: "stream" })
        return
      }
      this.listener("error", cue)
      return
    }
    const next: Engine = cue.sourceType === "procedural"
      ? this.procedural
      : cue.sourceType === "soundfont" ? this.soundfont : this.stream
    if (this.active && this.active !== next) this.active.stop()
    this.active = next
    next.setMasterVolume(this.master)
    next.setDucked(this.ducked)
    await next.play(cue)
  }
  setMasterVolume(value: number) { this.master = value; this.active?.setMasterVolume(value) }
  setDucked(value: boolean) { this.ducked = value; this.active?.setDucked(value) }
  setNarrativeScore(score: MusicBrainScoreV1 | null) { this.procedural.setNarrativeScore(score) }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, regionId?: string) { this.active?.setNarrativeDirection(intensity, silence, seconds, regionId) }
  pause() { this.active?.pause() }
  async resume() { await this.active?.resume() }
  stop() { this.active?.stop(); this.active = null }
  dispose() { this.stream.dispose(); this.procedural.dispose(); this.soundfont.dispose(); this.active = null }
}
