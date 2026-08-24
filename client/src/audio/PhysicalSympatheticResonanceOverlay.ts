import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { physicalPerformanceStateAt } from "@shared/physical-performance-control"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]

export interface SympatheticResonanceOptions {
  startAt: number
  event: LinearScoreEventV2
  track: LinearScoreTrackV2
  midi: number
  destination: AudioNode
  controls?: readonly LinearScoreControlV2[]
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function midiHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12) }
function scheduleParam(param: AudioParam, at: number, value: number, rampSeconds: number, exponential = false) {
  const safe = exponential ? Math.max(1e-5, value) : value
  if (rampSeconds > 0) {
    if (exponential) param.exponentialRampToValueAtTime(safe, at + rampSeconds)
    else param.linearRampToValueAtTime(safe, at + rampSeconds)
  } else param.setValueAtTime(safe, at)
}

interface ResonanceProfile {
  partials: readonly { ratio: number; level: number; detune?: number }[]
  bodyHz: readonly number[]
  bodyQ: number
  brightness: number
  attackDelay: number
  decay: number
  sympatheticGain: number
  bodyGain: number
}

function profileFor(source: NativeHybridSource): ResonanceProfile {
  if (source.instrumentId === "keys.celesta") return {
    partials: [{ ratio: 2, level: 0.52 }, { ratio: 3.98, level: 0.3 }, { ratio: 6.05, level: 0.16 }],
    bodyHz: [620, 1_280, 2_450, 4_700], bodyQ: 3.2, brightness: 8_800,
    attackDelay: 0.018, decay: 2.4, sympatheticGain: 0.72, bodyGain: 0.35,
  }
  if (source.instrumentId === "strings.harp") return {
    partials: [{ ratio: 1, level: 0.42 }, { ratio: 2, level: 0.3 }, { ratio: 3, level: 0.18 }, { ratio: 4.02, level: 0.1 }],
    bodyHz: [115, 230, 470, 920], bodyQ: 2.5, brightness: 5_600,
    attackDelay: 0.022, decay: 3.8, sympatheticGain: 0.68, bodyGain: 0.42,
  }
  if (source.instrumentId === "guitar.acoustic") return {
    partials: [{ ratio: 1, level: 0.36 }, { ratio: 2, level: 0.28 }, { ratio: 3, level: 0.14 }, { ratio: 4, level: 0.08 }],
    bodyHz: [98, 195, 390, 780], bodyQ: 2.2, brightness: 4_800,
    attackDelay: 0.02, decay: 2.1, sympatheticGain: 0.6, bodyGain: 0.5,
  }
  return {
    partials: [{ ratio: 1, level: 0.3 }, { ratio: 2, level: 0.24 }, { ratio: 3, level: 0.14 }, { ratio: 4.01, level: 0.09 }, { ratio: 5.02, level: 0.055 }],
    bodyHz: [92, 184, 368, 735, 1_470], bodyQ: 2.35, brightness: 6_800,
    attackDelay: 0.026, decay: 4.5, sympatheticGain: 0.62, bodyGain: 0.44,
  }
}

/** Hybrid Resonance v1.1: sample transient + pedal/damper/coupling-aware body response. */
export function scheduleSympatheticResonanceOverlay(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: SympatheticResonanceOptions,
) {
  const { event, track, midi, destination, startAt, controls = [] } = options
  if (midi < source.midiMin || midi > source.midiMax) return null

  const profile = profileFor(source)
  const state0 = physicalPerformanceStateAt(track, controls, event.timeSeconds)
  const hz = midiHz(midi)
  const pressure = clamp01(event.velocity * 0.62 + state0.pressure * 0.38)
  const brightness = clamp01(track.brightness)
  const coupling = state0.sympatheticCoupling
  const pluckPosition = state0.pluckPosition
  const pedal = state0.pedal
  const damper = state0.damper
  const start = startAt + event.timeSeconds + profile.attackDelay
  const sustain = Math.max(0.08, event.durationSeconds - profile.attackDelay)
  const tail = profile.decay * (0.5 + pressure * 0.22 + coupling * 0.34 + pedal * 0.48) * (1 - damper * 0.22)
  const stop = start + sustain + tail

  const resonanceBus = context.createGain(); resonanceBus.gain.value = 1
  const partialOscillators: OscillatorNode[] = []
  const partialGains: GainNode[] = []

  const pluckSpectral = 0.78 + pluckPosition * 0.4
  for (const partial of profile.partials) {
    const oscillator = context.createOscillator(); oscillator.type = "sine"; oscillator.frequency.value = hz * partial.ratio
    if (partial.detune) oscillator.detune.value = partial.detune
    const gain = context.createGain(); gain.gain.value = partial.level * profile.sympatheticGain * (0.58 + pressure * 0.16 + coupling * 0.34) * pluckSpectral
    oscillator.connect(gain); gain.connect(resonanceBus)
    partialOscillators.push(oscillator); partialGains.push(gain)
  }

  const bodyBus = context.createGain(); bodyBus.gain.value = profile.bodyGain * (0.7 + coupling * 0.5)
  for (const bodyFrequency of profile.bodyHz) {
    const excitation = context.createOscillator(); excitation.type = "sine"; excitation.frequency.value = bodyFrequency
    const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = bodyFrequency; filter.Q.value = profile.bodyQ
    const gain = context.createGain(); gain.gain.value = 0.045 * (0.72 + pressure * 0.15 + coupling * 0.35)
    excitation.connect(filter); filter.connect(gain); gain.connect(bodyBus)
    partialOscillators.push(excitation); partialGains.push(gain)
  }
  bodyBus.connect(resonanceBus)

  const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = profile.brightness * (0.52 + brightness * 0.46 + pluckPosition * 0.18); tone.Q.value = 0.32
  const output = context.createGain(); output.gain.value = 0
  resonanceBus.connect(tone); tone.connect(output); output.connect(destination)

  for (const control of controls) {
    if (control.trackId !== event.trackId || control.timeSeconds <= event.timeSeconds || control.timeSeconds > event.timeSeconds + event.durationSeconds) continue
    const at = startAt + control.timeSeconds
    const state = physicalPerformanceStateAt(track, controls, control.timeSeconds)
    const p = clamp01(event.velocity * 0.62 + state.pressure * 0.38)
    const couplingNow = state.sympatheticCoupling
    const pluckNow = state.pluckPosition
    for (let i = 0; i < partialGains.length; i += 1) {
      const base = partialGains[i].gain.value
      scheduleParam(partialGains[i].gain, at, base * (0.72 + p * 0.08 + couplingNow * 0.28), control.rampSeconds)
    }
    scheduleParam(bodyBus.gain, at, profile.bodyGain * (0.7 + couplingNow * 0.5), control.rampSeconds)
    scheduleParam(tone.frequency, at, profile.brightness * (0.52 + (control.brightness ?? brightness) * 0.46 + pluckNow * 0.18), control.rampSeconds, true)
    if (control.pitchBend !== null) {
      const cents = control.pitchBend * 100
      for (let i = 0; i < profile.partials.length; i += 1) scheduleParam(partialOscillators[i].detune, at, cents, control.rampSeconds)
    }
  }

  const peak = Math.max(0.001, source.wet * (0.58 + pressure * 0.17 + coupling * 0.2 + pedal * 0.12) * (1 - damper * 0.08))
  output.gain.setValueAtTime(0.0001, start)
  output.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.11, sustain * 0.35))
  output.gain.setValueAtTime(Math.max(0.001, peak * (0.6 + pedal * 0.14)), start + sustain)
  output.gain.exponentialRampToValueAtTime(0.0001, stop)

  for (const oscillator of partialOscillators) { oscillator.start(start); oscillator.stop(stop + 0.04) }
  return { endSeconds: event.timeSeconds + event.durationSeconds + tail }
}
