import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"
import { linearScoreRecipeFor, type LinearScoreTrack } from "@shared/audio"
import { manifestsForModule } from "@shared/instrument-manifest"
import { fetchAudioResource } from "./AudioResourceCache"
import type { MusicCue, MusicState } from "./MusicEngine"
import { buildPerformancePlan } from "./PerformanceEngine"
import { buildSamplerEventPlan, spessaSynthActions } from "./SamplerAdapter"
import { createSampledMixMaster } from "./ScoreMixMaster"
import {
  articulationDurationFactor, articulationVelocityFactor, midiNotesToFrequencies, scoreBrightnessFrequency, scorePedalReleaseTime,
  scoreMonitorVolume, scoreRenderProfile, scoreTrackBrightness, scoreTrackEnvelope,
  scoreTrackExpression, scoreTrackTimbre, scoreTrackVibrato, scoreVelocityGain,
} from "./ScoreAudioMath"

type Listener = (state: MusicState, cue: MusicCue | null) => void

export class LinearScoreEngine {
  private tone: typeof import("tone") | null = null
  private cue: MusicCue | null = null
  private output: any = null
  private context: AudioContext | null = null
  private soundfont: import("spessasynth_lib").WorkletSynthesizer | null = null
  private moduleTimer = 0
  private completionTimer = 0
  private synths = new Map<string, any>()
  private trackNodes = new Map<string, { filter: any; gain: any; vibrato: any; baseFilterHz: number; baseGain: number }>()
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
      const compressor = new Tone.MultibandCompressor({
        lowFrequency: 180,
        highFrequency: 3_800,
        low: { threshold: -18, ratio: 2.2, knee: 12, attack: 0.025, release: 0.3 },
        mid: { threshold: -20, ratio: 2.5, knee: 14, attack: 0.012, release: 0.22 },
        high: { threshold: -22, ratio: 2, knee: 10, attack: 0.006, release: 0.16 },
      })
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

      const maxPolyphony = Math.max(4, Math.min(32, Math.floor(render.polyphonyBudget / recipe.plan.tracks.length)))
      for (const track of recipe.plan.tracks) {
        const synth = this.createSynth(Tone, track, maxPolyphony)
        const timbre = scoreTrackTimbre(track)
        const filter = new Tone.Filter({ type: "lowpass", frequency: scoreBrightnessFrequency(timbre.filterHz, scoreTrackBrightness(track)), rolloff: -24, Q: timbre.filterQ })
        const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.22, wet: scoreTrackVibrato(track) * 0.55 })
        const panner = new Tone.Panner(track.pan)
        const baseGain = track.gain * timbre.level
        const gain = new Tone.Gain(baseGain * scoreTrackExpression(track))
        synth.chain(vibrato, filter, panner, gain, chorus)
        this.synths.set(track.id, synth)
        this.trackNodes.set(track.id, { filter, gain, vibrato, baseFilterHz: timbre.filterHz, baseGain })
        this.nodes.push(vibrato, filter, panner, gain)
      }

      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      transport.bpm.value = recipe.plan.bpm
      transport.timeSignature = [recipe.plan.meter.numerator, recipe.plan.meter.denominator]
      const beatSeconds = 60 / recipe.plan.bpm

      if (recipe.version === 2) {
        for (const control of recipe.plan.controls) {
          transport.schedule(time => {
            const nodes = this.trackNodes.get(control.trackId)
            if (!nodes) return
            const ramp = Math.max(0.001, control.rampSeconds)
            if (control.expression !== null) nodes.gain.gain.rampTo(nodes.baseGain * control.expression, ramp, time)
            if (control.brightness !== null) nodes.filter.frequency.rampTo(scoreBrightnessFrequency(nodes.baseFilterHz, control.brightness), ramp, time)
            if (control.vibrato !== null) nodes.vibrato.wet.rampTo(control.vibrato * 0.55, ramp, time)
            if (control.pitchBend !== null) this.synths.get(control.trackId)?.set({ detune: control.pitchBend * 100 })
          }, control.timeSeconds)
        }
      }

      for (const event of recipe.plan.events) {
        transport.schedule(time => {
          const articulation = "articulation" in event ? event.articulation : "normal"
          const eventStart = "timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds
          const baseDuration = ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds)
            * articulationDurationFactor(articulation)
          const duration = Math.max(baseDuration, scorePedalReleaseTime(recipe, event.trackId, eventStart + baseDuration) - eventStart)
          const synth = this.synths.get(event.trackId)
          const frequencies = midiNotesToFrequencies(event.notes)
          const velocity = Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(articulation))
          if (articulation === "tremolo") {
            const pulseSeconds = 0.12
            const pulses = Math.max(1, Math.ceil(baseDuration / pulseSeconds))
            for (let pulse = 0; pulse < pulses; pulse += 1) {
              synth?.triggerAttackRelease(frequencies, Math.min(0.085, Math.max(0.035, baseDuration - pulse * pulseSeconds)), time + pulse * pulseSeconds, velocity)
            }
          } else {
            synth?.triggerAttackRelease(frequencies, duration, time, velocity)
          }
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
    return scoreMonitorVolume(
      this.master,
      this.cue?.volume ?? 1,
      this.duckFactor,
      this.narrativeGain,
      this.cue?.monitoring === "reference",
    )
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
    const mix = createSampledMixMaster(context, 0)
    synth.connect(mix.input)
    mix.output.connect(context.destination)
    await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), "tloque-score-module")
    await synth.isReady

    this.context = context
    this.soundfont = synth
    this.output = mix.output
    this.cue = cue
    await context.resume()

    const beatSeconds = 60 / recipe.plan.bpm
    const totalSeconds = "totalSeconds" in recipe.plan ? recipe.plan.totalSeconds : recipe.plan.totalBeats * beatSeconds
    const playableTracks = recipe.plan.tracks.slice(0, 16)
    const tracksById = new Map(playableTracks.map(track => [track.id, track]))
    const performance = buildPerformancePlan(recipe, manifestsForModule(cue.instrumentManifestId))
    const startAt = context.currentTime + 0.08
    for (const { channel, track, program } of performance.channels) {
      const timbre = scoreTrackTimbre(track)
      synth.programChange(channel, program, { time: startAt })
      synth.controllerChange(channel, 7 as any, Math.round(Math.min(1, track.gain * timbre.level) * 127), { time: startAt })
      synth.controllerChange(channel, 10 as any, Math.round((track.pan + 1) * 63.5), { time: startAt })
      synth.controllerChange(channel, 11 as any, Math.round(scoreTrackExpression(track) * 127), { time: startAt })
      synth.controllerChange(channel, 74 as any, Math.round(scoreTrackBrightness(track) * 127), { time: startAt })
      synth.controllerChange(channel, 1 as any, Math.round(scoreTrackVibrato(track) * 127), { time: startAt })
      synth.controllerChange(channel, 64 as any, 0, { time: startAt })
      synth.controllerChange(channel, 91 as any, Math.round((0.18 + timbre.level * 0.18) * 127), { time: startAt })
      synth.controllerChange(channel, 93 as any, Math.round((track.synth === "pad" ? 0.1 : 0.035) * 127), { time: startAt })
      synth.pitchWheelRange(channel, 2, { time: startAt })
      synth.pitchWheel(channel, 8_192, { time: startAt })
    }

    const scheduleCycle = (cycleStart: number) => {
      const states = new Map(playableTracks.map(track => [track.id, {
        expression: scoreTrackExpression(track),
        brightness: scoreTrackBrightness(track),
        vibrato: scoreTrackVibrato(track),
        pitchBend: 0,
      }]))
      for (const track of playableTracks) {
        for (const channel of performance.channelsForTrack(track.id)) {
          synth.controllerChange(channel, 11 as any, Math.round(scoreTrackExpression(track) * 127), { time: cycleStart })
          synth.controllerChange(channel, 74 as any, Math.round(scoreTrackBrightness(track) * 127), { time: cycleStart })
          synth.controllerChange(channel, 1 as any, Math.round(scoreTrackVibrato(track) * 127), { time: cycleStart })
          synth.controllerChange(channel, 64 as any, 0, { time: cycleStart })
          synth.pitchWheel(channel, 8_192, { time: cycleStart })
        }
      }
      if (recipe.version === 2) {
        for (const control of recipe.plan.controls) {
          const trackChannels = performance.channelsForTrack(control.trackId)
          const state = states.get(control.trackId)
          if (!trackChannels.length || !state) continue
          const controlAt = cycleStart + control.timeSeconds
          const scheduleController = (key: "expression" | "brightness" | "vibrato", controller: number, target: number | null) => {
            if (target === null) return
            const steps = control.rampSeconds > 0 ? Math.max(2, Math.min(16, Math.ceil(control.rampSeconds * 8))) : 1
            const from = state[key]
            for (let step = 1; step <= steps; step += 1) {
              const fraction = step / steps
              for (const channel of trackChannels) {
                synth.controllerChange(channel, controller as any, Math.round((from + (target - from) * fraction) * 127), {
                  time: controlAt + control.rampSeconds * fraction,
                })
              }
            }
            state[key] = target
          }
          scheduleController("expression", 11, control.expression)
          scheduleController("brightness", 74, control.brightness)
          scheduleController("vibrato", 1, control.vibrato)
          if (control.pedal !== null) for (const channel of trackChannels) synth.controllerChange(channel, 64 as any, control.pedal ? 127 : 0, { time: controlAt })
          if (control.pitchBend !== null) {
            const steps = control.rampSeconds > 0 ? Math.max(2, Math.min(16, Math.ceil(control.rampSeconds * 8))) : 1
            const from = state.pitchBend
            for (let step = 1; step <= steps; step += 1) {
              const fraction = step / steps
              const bend = from + (control.pitchBend - from) * fraction
              for (const channel of trackChannels) {
                synth.pitchWheel(channel, Math.max(0, Math.min(16_383, Math.round(8_192 + bend / 2 * 8_191))), {
                  time: controlAt + control.rampSeconds * fraction,
                })
              }
            }
            state.pitchBend = control.pitchBend
          }
        }
      }
      for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
        const event = recipe.plan.events[eventIndex]
        const track = tracksById.get(event.trackId)
        const decision = performance.decisionForEvent(eventIndex)
        if (!track || !decision) continue
        const channel = performance.channelForEventIndex(eventIndex)
        if (channel === undefined) continue
        const noteAt = cycleStart + ("timeSeconds" in event ? event.timeSeconds : event.timeBeats * beatSeconds)
        const factor = articulationDurationFactor(decision.articulation)
        const baseDuration = ("durationSeconds" in event ? event.durationSeconds : event.durationBeats * beatSeconds) * factor
        const velocity = Math.round(Math.min(1, scoreVelocityGain(event.velocity) * articulationVelocityFactor(decision.articulation)) * 127)
        const samplerPlan = buildSamplerEventPlan(decision, decision.route)
        const setupAt = Math.max(cycleStart, noteAt - 0.01)
        for (const action of spessaSynthActions(samplerPlan)) {
          if (action.type === "controller") {
            synth.controllerChange(channel, action.cc as any, action.value, { time: setupAt })
          } else if (action.type === "keyswitch") {
            synth.noteOn(channel, action.note, action.velocity, { time: Math.max(cycleStart, setupAt - 0.015) })
            synth.noteOff(channel, action.note, { time: setupAt })
          }
        }
        const usesDedicatedTremolo = decision.articulation === "tremolo" && decision.source === "dedicated-articulation"
        if (decision.articulation === "tremolo" && !usesDedicatedTremolo) {
          const pulseSeconds = 0.12
          const pulses = Math.max(1, Math.ceil(baseDuration / pulseSeconds))
          for (let pulse = 0; pulse < pulses; pulse += 1) {
            const pulseAt = noteAt + pulse * pulseSeconds
            const pulseEnd = pulseAt + Math.min(0.085, Math.max(0.035, baseDuration - pulse * pulseSeconds))
            for (const note of event.notes) {
              synth.noteOn(channel, note, velocity, { time: pulseAt })
              synth.noteOff(channel, note, { time: pulseEnd })
            }
          }
        } else {
          const releaseAt = noteAt + baseDuration
          for (const note of event.notes) {
            synth.noteOn(channel, note, velocity, { time: noteAt })
            synth.noteOff(channel, note, { time: releaseAt })
          }
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
    mix.output.gain.linearRampToValueAtTime(this.targetVolume(), context.currentTime + Math.max(0.25, cue.crossfadeSeconds))
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
    this.trackNodes.clear()
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
