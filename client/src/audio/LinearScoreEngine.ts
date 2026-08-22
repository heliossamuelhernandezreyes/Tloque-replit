import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"
import { linearScoreRecipeFor, type LinearScoreTrack } from "@shared/audio"
import { fetchAudioResource } from "./AudioResourceCache"
import type { MusicCue, MusicState } from "./MusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void

// Ejecuta únicamente el plan compilado. El texto TloqueScore nunca llega a
// eval/Function ni se interpreta como JavaScript en el dispositivo.
export class LinearScoreEngine {
  private tone: typeof import("tone") | null = null
  private cue: MusicCue | null = null
  private output: any = null
  private context: AudioContext | null = null
  private soundfont: import("spessasynth_lib").WorkletSynthesizer | null = null
  private moduleTimer = 0
  private completionTimer = 0
  private synths = new Map<string, any>()
  private nodes: any[] = []
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    this.listener("loading", cue)
    try {
      this.stopRuntime()
      const recipe = linearScoreRecipeFor(cue.recipe)
      if (cue.packUrl) {
        await this.playWithModule(cue, recipe)
        return
      }
      const Tone = this.tone ?? await import("tone")
      this.tone = Tone
      await Tone.start()
      const output = new Tone.Gain(0).toDestination()
      const limiter = new Tone.Limiter(-5)
      limiter.connect(output)
      this.output = output
      this.nodes = [limiter, output]
      this.cue = cue

      for (const track of recipe.plan.tracks) {
        const synth = this.createSynth(Tone, track)
        const panner = new Tone.Panner(track.pan)
        const gain = new Tone.Gain(track.gain)
        synth.chain(panner, gain, limiter)
        this.synths.set(track.id, synth)
        this.nodes.push(panner, gain)
      }

      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      transport.bpm.value = recipe.plan.bpm
      transport.timeSignature = [recipe.plan.meter.numerator, recipe.plan.meter.denominator]
      const beatSeconds = 60 / recipe.plan.bpm

      for (const event of recipe.plan.events) {
        transport.schedule(time => {
          this.synths.get(event.trackId)?.triggerAttackRelease(
            event.notes,
            "durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds,
            time,
            event.velocity,
          )
        }, "timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds)
      }

      const totalSeconds = "totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * beatSeconds
      transport.loopStart = 0
      transport.loopEnd = totalSeconds
      transport.loop = cue.loop && recipe.plan.loop
      if (!transport.loop) {
        transport.schedule(time => {
          for (const synth of this.synths.values()) synth.releaseAll?.(time)
          transport.stop(time + 0.05)
          this.listener("paused", this.cue)
        }, totalSeconds)
      }
      transport.start()
      output.gain.rampTo(this.targetVolume(), Math.max(0.2, cue.crossfadeSeconds))
      this.listener("playing", cue)
    } catch (error) {
      console.error("TloqueScore playback failed:", error)
      this.stopRuntime()
      this.listener("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0.08 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    if (this.context && this.output) {
      this.output.gain.cancelScheduledValues(this.context.currentTime)
      this.output.gain.linearRampToValueAtTime(this.targetVolume(), this.context.currentTime + Math.max(0.25, seconds))
    } else this.output?.gain.rampTo(this.targetVolume(), Math.max(0.25, seconds))
  }
  pause() {
    if (this.context) void this.context.suspend()
    else this.tone?.getTransport().pause()
    this.listener("paused", this.cue)
  }
  async resume() {
    if (!this.cue) return
    if (this.context) await this.context.resume()
    else {
      if (!this.tone) return
      await this.tone.start()
      this.tone.getTransport().start()
    }
    this.listener("playing", this.cue)
  }
  stop() { this.stopRuntime(); this.cue = null; this.listener("idle", null) }
  dispose() { this.stop() }

  private createSynth(Tone: typeof import("tone"), track: LinearScoreTrack) {
    const envelope = track.synth === "pad"
      ? { attack: 1.1, decay: 0.7, sustain: 0.72, release: 3.8 }
      : track.synth === "bell"
        ? { attack: 0.008, decay: 1.1, sustain: 0.04, release: 2.4 }
        : track.synth === "pluck"
          ? { attack: 0.003, decay: 0.25, sustain: 0.08, release: 0.7 }
          : track.synth === "bass"
            ? { attack: 0.02, decay: 0.4, sustain: 0.55, release: 1.2 }
            : { attack: 0.12, decay: 0.45, sustain: 0.52, release: 1.8 }
    const oscillator = track.synth === "bass" ? "triangle" : track.synth === "pluck" ? "sine" : "fatsine"
    return new Tone.PolySynth(Tone.Synth, { oscillator: { type: oscillator as any }, envelope })
  }

  private targetVolume() {
    return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain))
  }
  private applyVolume() {
    if (this.context && this.output) {
      this.output.gain.cancelScheduledValues(this.context.currentTime)
      this.output.gain.linearRampToValueAtTime(this.targetVolume(), this.context.currentTime + 0.18)
    } else this.output?.gain.rampTo(this.targetVolume(), 0.18)
  }

  private async playWithModule(cue: MusicCue, recipe: ReturnType<typeof linearScoreRecipeFor>) {
    const context = new AudioContext({ latencyHint: "playback" })
    await context.audioWorklet.addModule(processorUrl)
    const [{ WorkletSynthesizer }, response] = await Promise.all([
      import("spessasynth_lib"),
      fetchAudioResource(cue.packUrl!),
    ])
    if (!response.ok) throw new Error(`Módulo instrumental ${response.status}`)
    const synth = new WorkletSynthesizer(context)
    const output = context.createGain()
    output.gain.value = 0
    synth.connect(output)
    output.connect(context.destination)
    await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), "tloque-score-module")
    await synth.isReady

    this.context = context
    this.soundfont = synth
    this.output = output
    this.cue = cue
    await context.resume()

    const beatSeconds = 60 / recipe.plan.bpm
    const totalSeconds = "totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * beatSeconds
    const channels = new Map(recipe.plan.tracks.slice(0, 16).map((track, index) => [track.id, index]))
    const startAt = context.currentTime + 0.08
    for (const track of recipe.plan.tracks.slice(0, 16)) {
      const channel = channels.get(track.id)!
      const program = "program" in track ? track.program : ({ warm: 0, pad: 48, bell: 8, pluck: 24, bass: 32 } as const)[track.synth]
      synth.programChange(channel, Number(program), { time: startAt })
      synth.controllerChange(channel, 7 as any, Math.round(track.gain * 127), { time: startAt })
      synth.controllerChange(channel, 10 as any, Math.round((track.pan + 1) * 63.5), { time: startAt })
    }

    const scheduleCycle = (cycleStart: number) => {
      for (const event of recipe.plan.events) {
        const channel = channels.get(event.trackId)
        if (channel === undefined) continue
        const noteAt = cycleStart + ("timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds)
        const articulation = "articulation" in event ? event.articulation : "normal"
        const factor = articulation === "staccato" ? 0.55 : articulation === "legato" ? 1.06 : 0.96
        const releaseAt = noteAt + ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds) * factor
        for (const note of event.notes) {
          synth.noteOn(channel, note, Math.round(event.velocity * 127), { time: noteAt })
          synth.noteOff(channel, note, { time: releaseAt })
        }
      }
    }

    scheduleCycle(startAt)
    if (cue.loop && recipe.plan.loop) {
      let nextCycle = startAt + totalSeconds
      scheduleCycle(nextCycle)
      nextCycle += totalSeconds
      this.moduleTimer = window.setInterval(() => {
        if (!this.context || !this.soundfont) return
        while (nextCycle < this.context.currentTime + totalSeconds * 1.5) {
          scheduleCycle(nextCycle)
          nextCycle += totalSeconds
        }
      }, Math.max(1_000, Math.min(30_000, totalSeconds * 500)))
    } else {
      this.completionTimer = window.setTimeout(() => {
        this.soundfont?.stopAll(false)
        this.listener("paused", this.cue)
      }, (totalSeconds + 0.3) * 1_000)
    }
    output.gain.linearRampToValueAtTime(this.targetVolume(), context.currentTime + Math.max(0.25, cue.crossfadeSeconds))
    this.listener("playing", cue)
  }

  private stopRuntime() {
    window.clearInterval(this.moduleTimer)
    window.clearTimeout(this.completionTimer)
    this.moduleTimer = 0
    this.completionTimer = 0
    const transport = this.tone?.getTransport()
    transport?.stop()
    transport?.cancel()
    for (const synth of this.synths.values()) {
      synth.releaseAll?.()
      synth.dispose?.()
    }
    this.synths.clear()
    for (const node of this.nodes) node?.dispose?.()
    this.nodes = []
    this.soundfont?.stopAll(true)
    this.soundfont?.destroy()
    this.soundfont = null
    if (this.context) void this.context.close()
    this.context = null
    this.output?.disconnect?.()
    this.output = null
  }
}
