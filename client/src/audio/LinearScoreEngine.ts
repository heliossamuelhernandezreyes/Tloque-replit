import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"
import { linearScoreRecipeFor, type LinearScoreTrack } from "@shared/audio"
import { fetchAudioResource } from "./AudioResourceCache"
import type { MusicCue, MusicState } from "./MusicEngine"
import {
  articulationDurationFactor, midiNotesToFrequencies, scoreTrackEnvelope,
  scoreRenderProfile, scoreTrackTimbre, scoreVelocityGain,
} from "./ScoreAudioMath"

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
      const render = scoreRenderProfile(recipe.version === 2 ? recipe.plan.quality : "studio")
      const output = new Tone.Gain(0).toDestination()
      const limiter = new Tone.Limiter(-1)
      const compressor = new Tone.Compressor({ threshold: -20, ratio: 2.6, knee: 14, attack: 0.015, release: 0.24 })
      const makeup = new Tone.Gain(render.makeup)
      const eq = new Tone.EQ3({ low: -1, mid: 0.6, high: 1.2, lowFrequency: 240, highFrequency: 3_600 })
      const widener = new Tone.StereoWidener(render.stereoWidth)
      const reverb = new Tone.Reverb({ decay: render.reverbDecay, preDelay: 0.035, wet: render.reverbWet })
      const chorus = new Tone.Chorus({ frequency: 0.16, delayTime: 3.8, depth: 0.22, spread: 150, wet: render.chorusWet }).start()
      chorus.chain(reverb, widener, eq, makeup, compressor, limiter, output)
      await reverb.generate()
      this.output = output
      this.nodes = [chorus, reverb, widener, eq, makeup, compressor, limiter, output]
      this.cue = cue

      const maxPolyphony = Math.max(4, Math.min(16, Math.floor(render.polyphonyBudget / recipe.plan.tracks.length)))
      for (const track of recipe.plan.tracks) {
        const synth = this.createSynth(Tone, track, maxPolyphony)
        const timbre = scoreTrackTimbre(track)
        const filter = new Tone.Filter({ type: "lowpass", frequency: timbre.filterHz, rolloff: -24, Q: timbre.filterQ })
        const panner = new Tone.Panner(track.pan)
        const gain = new Tone.Gain(track.gain * timbre.level)
        synth.chain(filter, panner, gain, chorus)
        this.synths.set(track.id, synth)
        this.nodes.push(filter, panner, gain)
      }

      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      transport.bpm.value = recipe.plan.bpm
      transport.timeSignature = [recipe.plan.meter.numerator, recipe.plan.meter.denominator]
      const beatSeconds = 60 / recipe.plan.bpm

      for (const event of recipe.plan.events) {
        transport.schedule(time => {
          const articulation = "articulation" in event ? event.articulation : "normal"
          const duration = ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds)
            * articulationDurationFactor(articulation)
          this.synths.get(event.trackId)?.triggerAttackRelease(
            midiNotesToFrequencies(event.notes),
            duration,
            time,
            scoreVelocityGain(event.velocity),
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

  private createSynth(Tone: typeof import("tone"), track: LinearScoreTrack, maxPolyphony: number) {
    const envelope = scoreTrackEnvelope(track)
    let synth: any
    if (track.synth === "pad") {
      synth = new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.005,
        oscillator: { type: "fatsine" },
        envelope,
        modulation: { type: "sine" },
        modulationEnvelope: { attack: envelope.attack * 1.4, decay: 0.8, sustain: 0.48, release: envelope.release },
      })
    } else if (track.synth === "bell") {
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 8.5,
        oscillator: { type: "sine" },
        envelope,
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.004, decay: 1.1, sustain: 0.01, release: envelope.release },
      })
    } else if (track.synth === "warm") {
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.5,
        modulationIndex: 1.65,
        oscillator: { type: "fatsine" },
        envelope,
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.01, decay: 0.7, sustain: 0.18, release: envelope.release * 0.8 },
      })
    } else {
      const oscillator = track.synth === "bass" ? "fatsawtooth" : "triangle8"
      synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: oscillator as any }, envelope })
    }
    synth.maxPolyphony = maxPolyphony
    return synth
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
    const lowShelf = context.createBiquadFilter()
    lowShelf.type = "lowshelf"
    lowShelf.frequency.value = 220
    lowShelf.gain.value = -1
    const highShelf = context.createBiquadFilter()
    highShelf.type = "highshelf"
    highShelf.frequency.value = 3_600
    highShelf.gain.value = 1.2
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -20
    compressor.knee.value = 14
    compressor.ratio.value = 2.6
    compressor.attack.value = 0.015
    compressor.release.value = 0.24
    synth.connect(lowShelf)
    lowShelf.connect(highShelf)
    highShelf.connect(compressor)
    compressor.connect(output)
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
      const timbre = scoreTrackTimbre(track)
      synth.programChange(channel, Number(program), { time: startAt })
      synth.controllerChange(channel, 7 as any, Math.round(Math.min(1, track.gain * timbre.level) * 127), { time: startAt })
      synth.controllerChange(channel, 10 as any, Math.round((track.pan + 1) * 63.5), { time: startAt })
    }

    const scheduleCycle = (cycleStart: number) => {
      for (const event of recipe.plan.events) {
        const channel = channels.get(event.trackId)
        if (channel === undefined) continue
        const noteAt = cycleStart + ("timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds)
        const articulation = "articulation" in event ? event.articulation : "normal"
        const factor = articulationDurationFactor(articulation)
        const releaseAt = noteAt + ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds) * factor
        for (const note of event.notes) {
          synth.noteOn(channel, note, Math.round(scoreVelocityGain(event.velocity) * 127), { time: noteAt })
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
