import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"
import { proceduralRecipeFor } from "@shared/audio"
import { fetchAudioResource } from "./AudioResourceCache"
import type { MusicCue, MusicState } from "./MusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void

const SCALE = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], pentatonic: [0, 3, 5, 7, 10],
} as const

export class SoundFontMusicEngine {
  private context: AudioContext | null = null
  private synth: import("spessasynth_lib").WorkletSynthesizer | null = null
  private output: GainNode | null = null
  private cue: MusicCue | null = null
  private timer = 0
  private releaseTimers: number[] = []
  private bar = 0
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    if (!cue.packUrl) return this.listener("error", cue)
    this.listener("loading", cue)
    try {
      this.stopRuntime()
      const context = new AudioContext({ latencyHint: "playback" })
      await context.audioWorklet.addModule(processorUrl)
      const { WorkletSynthesizer } = await import("spessasynth_lib")
      const response = await fetchAudioResource(cue.packUrl)
      if (!response.ok) throw new Error(`SoundFont ${response.status}`)
      const synth = new WorkletSynthesizer(context)
      const output = context.createGain()
      output.gain.value = 0
      synth.connect(output)
      output.connect(context.destination)
      await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), "tloque-main")
      await synth.isReady
      synth.programChange(0, Math.max(0, Math.min(127, cue.instrumentProgram ?? 48)))
      this.context = context
      this.synth = synth
      this.output = output
      this.cue = cue
      await context.resume()
      this.schedule()
      output.gain.linearRampToValueAtTime(this.targetVolume(), context.currentTime + Math.max(0.35, cue.crossfadeSeconds))
      this.listener("playing", cue)
    } catch (error) {
      console.error("SoundFont audio failed:", error)
      this.stopRuntime()
      this.listener("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0.08 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    if (this.context && this.output) this.output.gain.linearRampToValueAtTime(this.targetVolume(), this.context.currentTime + Math.max(0.25, seconds))
  }
  pause() { void this.context?.suspend(); this.listener("paused", this.cue) }
  async resume() { if (!this.context || !this.cue) return; await this.context.resume(); this.listener("playing", this.cue) }
  stop() { this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }

  private schedule() {
    if (!this.synth || !this.cue) return
    const recipe = proceduralRecipeFor(this.cue.recipe)
    const scale = SCALE[recipe.scale]
    const play = () => {
      if (!this.synth) return
      const degree = [0, 3, 5, 2][this.bar % 4] % scale.length
      const notes = [
        recipe.rootMidi + scale[degree],
        recipe.rootMidi + scale[(degree + 2) % scale.length] + (degree + 2 >= scale.length ? 12 : 0),
        recipe.rootMidi + scale[(degree + 4) % scale.length] + (degree + 4 >= scale.length ? 12 : 0),
      ]
      for (const note of notes) this.synth.noteOn(0, note, Math.round(38 + recipe.density * 28))
      const barMs = 240_000 / recipe.bpm
      this.releaseTimers.push(window.setTimeout(() => {
        for (const note of notes) this.synth?.noteOff(0, note)
      }, barMs * 0.82))
      this.bar += 1
    }
    play()
    this.timer = window.setInterval(play, 240_000 / recipe.bpm)
  }
  private targetVolume() { return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain)) }
  private applyVolume() {
    if (!this.context || !this.output) return
    this.output.gain.cancelScheduledValues(this.context.currentTime)
    this.output.gain.linearRampToValueAtTime(this.targetVolume(), this.context.currentTime + 0.18)
  }
  private stopRuntime() {
    window.clearInterval(this.timer)
    for (const timer of this.releaseTimers) window.clearTimeout(timer)
    this.releaseTimers = []
    this.timer = 0
    this.synth?.stopAll(true)
    this.synth?.destroy()
    this.synth = null
    this.output?.disconnect()
    this.output = null
    if (this.context) void this.context.close()
    this.context = null
    this.bar = 0
  }
}
