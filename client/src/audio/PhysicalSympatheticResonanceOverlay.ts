import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { boundedHybridOverlayGain, type NativeHybridOverlayPerformance } from "@shared/native-hybrid-performance"
import { boundedHybridCalibrationTuning, type HybridCalibrationTuning } from "@shared/native-hybrid-tuning"
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
  calibrationTuning?: HybridCalibrationTuning
  performance?: NativeHybridOverlayPerformance
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

function pressureFor(eventVelocity: number, pressure: number) { return clamp01(eventVelocity * 0.62 + pressure * 0.38) }
function pluckSpectralFor(pluckPosition: number) { return 0.78 + clamp01(pluckPosition) * 0.4 }
function partialGainFor(profile: ResonanceProfile, level: number, pressure: number, coupling: number, pluckPosition: number, bodyScale: number) {
  return level * profile.sympatheticGain * bodyScale * (0.58 + pressure * 0.16 + coupling * 0.34) * pluckSpectralFor(pluckPosition)
}
function bodyExcitationGainFor(pressure: number, coupling: number, bodyScale: number) { return 0.045 * bodyScale * (0.72 + pressure * 0.15 + coupling * 0.35) }
function bodyBusGainFor(profile: ResonanceProfile, coupling: number, damper: number, bodyScale: number) { return profile.bodyGain * bodyScale * (0.7 + coupling * 0.5) * (1 - damper * 0.18) }
function toneHzFor(profile: ResonanceProfile, brightness: number, pluckPosition: number, damper: number, dampingScale: number) {
  return profile.brightness * dampingScale * (0.52 + brightness * 0.46 + pluckPosition * 0.18) * (1 - damper * 0.16)
}
function wetGainFor(source: NativeHybridSource, pressure: number, coupling: number, pedal: number, damper: number, wetScale: number, performance?: NativeHybridOverlayPerformance) {
  return Math.max(0.0001, boundedHybridOverlayGain(source, source.wet * wetScale * (0.58 + pressure * 0.17 + coupling * 0.2 + pedal * 0.12) * (1 - damper * 0.18), performance))
}
function tailFor(profile: ResonanceProfile, pressure: number, coupling: number, pedal: number, damper: number, decayScale: number) {
  return profile.decay * decayScale * (0.5 + pressure * 0.22 + coupling * 0.34 + pedal * 0.48) * (1 - damper * 0.42)
}

/** Sympathetic engine v1.1 under the sample-dominant performance-v2 contract. */
export function scheduleSympatheticResonanceOverlay(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: SympatheticResonanceOptions,
) {
  const { event, track, midi, destination, startAt, controls = [] } = options
  if (midi < source.midiMin || midi > source.midiMax) return null

  const tuning = boundedHybridCalibrationTuning(options.calibrationTuning)
  const profile = profileFor(source)
  const state0 = physicalPerformanceStateAt(track, controls, event.timeSeconds)
  const stateEnd = physicalPerformanceStateAt(track, controls, event.timeSeconds + event.durationSeconds)
  const hz = midiHz(midi)
  const pressure = pressureFor(event.velocity, state0.pressure)
  const endPressure = pressureFor(event.velocity, stateEnd.pressure)
  const brightness = clamp01(track.brightness)
  const coupling = state0.sympatheticCoupling
  const pluckPosition = state0.pluckPosition
  const pedal = state0.pedal
  const damper = state0.damper
  const start = startAt + event.timeSeconds + profile.attackDelay
  const sustain = Math.max(0.08, event.durationSeconds - profile.attackDelay)
  const tail = tailFor(profile, endPressure, stateEnd.sympatheticCoupling, stateEnd.pedal, stateEnd.damper, tuning.decayScale)
  const stop = start + sustain + Math.max(0.12, tail)

  const resonanceBus = context.createGain(); resonanceBus.gain.value = 1
  const partialOscillators: OscillatorNode[] = []
  const pitchedPartialGains: GainNode[] = []
  const bodyOscillators: OscillatorNode[] = []
  const bodyExcitationGains: GainNode[] = []

  for (const partial of profile.partials) {
    const oscillator = context.createOscillator(); oscillator.type = "sine"; oscillator.frequency.value = hz * partial.ratio
    if (partial.detune) oscillator.detune.value = partial.detune
    const gain = context.createGain(); gain.gain.value = partialGainFor(profile, partial.level, pressure, coupling, pluckPosition, tuning.bodyScale)
    oscillator.connect(gain); gain.connect(resonanceBus)
    partialOscillators.push(oscillator); pitchedPartialGains.push(gain)
  }

  const bodyBus = context.createGain(); bodyBus.gain.value = bodyBusGainFor(profile, coupling, damper, tuning.bodyScale)
  for (const bodyFrequency of profile.bodyHz) {
    const excitation = context.createOscillator(); excitation.type = "sine"; excitation.frequency.value = bodyFrequency
    const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = bodyFrequency; filter.Q.value = profile.bodyQ
    const gain = context.createGain(); gain.gain.value = bodyExcitationGainFor(pressure, coupling, tuning.bodyScale)
    excitation.connect(filter); filter.connect(gain); gain.connect(bodyBus)
    bodyOscillators.push(excitation); bodyExcitationGains.push(gain)
  }
  bodyBus.connect(resonanceBus)

  const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = toneHzFor(profile, brightness, pluckPosition, damper, tuning.dampingScale); tone.Q.value = 0.32
  const output = context.createGain(); output.gain.value = 0
  resonanceBus.connect(tone); tone.connect(output); output.connect(destination)

  const initialPeak = wetGainFor(source, pressure, coupling, pedal, damper, tuning.wetScale, options.performance)
  output.gain.setValueAtTime(0.0001, start)
  output.gain.exponentialRampToValueAtTime(initialPeak, start + Math.min(0.11, sustain * 0.35))

  for (const control of controls) {
    if (control.trackId !== event.trackId || control.timeSeconds <= event.timeSeconds || control.timeSeconds > event.timeSeconds + event.durationSeconds) continue
    const at = startAt + control.timeSeconds
    const state = physicalPerformanceStateAt(track, controls, control.timeSeconds)
    const p = pressureFor(event.velocity, state.pressure)
    const couplingNow = state.sympatheticCoupling
    const pluckNow = state.pluckPosition
    const damperNow = state.damper

    for (let i = 0; i < pitchedPartialGains.length; i += 1) scheduleParam(pitchedPartialGains[i].gain, at, partialGainFor(profile, profile.partials[i].level, p, couplingNow, pluckNow, tuning.bodyScale), control.rampSeconds)
    for (const gain of bodyExcitationGains) scheduleParam(gain.gain, at, bodyExcitationGainFor(p, couplingNow, tuning.bodyScale), control.rampSeconds)
    scheduleParam(bodyBus.gain, at, bodyBusGainFor(profile, couplingNow, damperNow, tuning.bodyScale), control.rampSeconds)
    scheduleParam(tone.frequency, at, toneHzFor(profile, control.brightness ?? brightness, pluckNow, damperNow, tuning.dampingScale), control.rampSeconds, true)
    scheduleParam(output.gain, at, wetGainFor(source, p, couplingNow, state.pedal, damperNow, tuning.wetScale, options.performance), control.rampSeconds, true)
    if (control.pitchBend !== null) {
      const cents = control.pitchBend * 100
      for (const oscillator of partialOscillators) scheduleParam(oscillator.detune, at, cents, control.rampSeconds)
    }
  }

  const finalPeak = wetGainFor(source, endPressure, stateEnd.sympatheticCoupling, stateEnd.pedal, stateEnd.damper, tuning.wetScale, options.performance)
  output.gain.setValueAtTime(Math.max(0.0001, finalPeak * (0.58 + stateEnd.pedal * 0.18) * (1 - stateEnd.damper * 0.16)), start + sustain)
  output.gain.exponentialRampToValueAtTime(0.0001, stop)

  for (const oscillator of partialOscillators) { oscillator.start(start); oscillator.stop(stop + 0.04) }
  for (const oscillator of bodyOscillators) { oscillator.start(start); oscillator.stop(stop + 0.04) }
  return { endSeconds: event.timeSeconds + event.durationSeconds + tail }
}
