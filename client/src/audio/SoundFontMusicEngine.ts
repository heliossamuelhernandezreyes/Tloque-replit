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
  private token = 0
  private paused = false
  private loading = false
  private controller = new AbortController()
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    if (!cue.packUrl) return this.listener("error", cue)
    const token = ++this.token
    this.paused = false; this.loading = true; this.cue = cue
    this.listener("loading", cue)
    try {
      this.stopRuntime()
      this.controller = new AbortController()
      const context = new AudioContext({ latencyHint: "playback" })
      this.context = context
      await context.audioWorklet.addModule(processorUrl)
      if (token !== this.token) return
      const { WorkletSynthesizer } = await import("spessasynth_lib")
      if (token !== this.token) return
      const response = await fetchAudioResource(cue.packUrl, {signal: this.controller.signal, expectedSha256: cue.packSha256})
      if (token !== this.token) return
      if (!response.ok) throw new Error(`SoundFont ${response.status}`)
      const synth = new WorkletSynthesizer(context)
      this.synth = synth
      const output = context.createGain()
      this.output = output
      output.gain.value = 0
      synth.connect(output)
      output.connect(context.destination)
      await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), "tloque-main")
      if (token !== this.token) return
      await synth.isReady
      if (token !== this.token) return
      synth.programChange(0, Math.max(0, Math.min(127, cue.instrumentProgram ?? 48)))
      this.context = context
      this.synth = synth
      this.output = output
      this.cue = cue
      if (!this.paused) await context.resume()
      if (token !== this.token) return
      if (this.paused) await context.suspend()
      if (token !== this.token) return
      this.loading = false
      this.schedule()
      output.gain.linearRampToValueAtTime(this.targetVolume(), context.currentTime + Math.max(0.35, cue.crossfadeSeconds))
      this.listener(this.paused ? "paused" : "playing", cue)
    } catch (error) {
      if (token !== this.token) return
      this.loading = false
      console.error("SoundFont audio failed:", error)
      this.stopRuntime()
      this.listener("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, _regionId?: string) {
    this.narrativeGain = silence ? 0 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    if (this.context && this.output) this.output.gain.linearRampToValueAtTime(this.targetVolume(), this.context.currentTime + Math.max(0.25, seconds))
  }
  pause() { this.paused = true; void this.context?.suspend(); this.listener("paused", this.cue) }
  async resume() {
    this.paused = false
    if (this.loading || !this.context || !this.cue) return
    const token = this.token
    await this.context.resume()
    if (token === this.token && !this.paused) this.listener("playing", this.cue)
  }
  stop() { ++this.token; this.loading = false; this.paused = false; this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }

  private schedule() {
    if (!this.synth || !this.cue || !this.context) return
    const recipe = proceduralRecipeFor(this.cue.recipe), scale = SCALE[recipe.scale]
    const context = this.context, synth = this.synth, barSeconds = 240 / recipe.bpm
    const startAt = context.currentTime + .05
    const pump = () => {
      if (this.context !== context || this.paused || context.state === "suspended") return
      // Timers wake the planner; only the audio clock determines musical phase.
      this.bar = Math.max(this.bar, Math.floor(Math.max(0, context.currentTime - startAt) / barSeconds))
      while (startAt + this.bar * barSeconds < context.currentTime + .6) {
        const nominalStart = startAt + this.bar * barSeconds
        if (nominalStart < context.currentTime - .1) { this.bar += 1; continue }
        const degree = [0, 3, 5, 2][this.bar % 4] % scale.length
        const notes = [
          recipe.rootMidi + scale[degree],
          recipe.rootMidi + scale[(degree + 2) % scale.length] + (degree + 2 >= scale.length ? 12 : 0),
          recipe.rootMidi + scale[(degree + 4) % scale.length] + (degree + 4 >= scale.length ? 12 : 0),
        ]
        const when = Math.max(context.currentTime + .01, nominalStart)
        for (const note of notes) {
          synth.noteOn(0, note, Math.round(38 + recipe.density * 28), {time: when})
          synth.noteOff(0, note, {time: when + barSeconds * .82})
        }
        this.bar += 1
      }
    }
    pump(); this.timer = window.setInterval(pump, 200)
  }
  private targetVolume() { return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain)) }
  private applyVolume() {
    if (!this.context || !this.output) return
    this.output.gain.cancelScheduledValues(this.context.currentTime)
    if (this.targetVolume() === 0) this.output.gain.setValueAtTime(0, this.context.currentTime)
    else this.output.gain.linearRampToValueAtTime(this.targetVolume(), this.context.currentTime + 0.18)
  }
  private stopRuntime() {
    this.controller.abort()
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
