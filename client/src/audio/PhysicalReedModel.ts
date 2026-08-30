import type { NativePhysicalModelSource } from "@shared/native-acoustic-source"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { deterministicNoiseOffset, sharedDeterministicNoiseBuffer } from "./DeterministicAudioNoise"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]

export interface PhysicalModelVoiceOptions {
  startAt: number
  event: LinearScoreEventV2
  track: LinearScoreTrackV2
  midi: number
  destination: AudioNode
  controls?: readonly LinearScoreControlV2[]
  legatoFromPrevious?: boolean
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function midiHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12) }
function centsForSemitones(semitones: number) { return semitones * 100 }

function createSaturator(context: BaseAudioContext, amount: number) {
  const node = context.createWaveShaper()
  const size = 1024
  const curve = new Float32Array(size)
  const drive = 1 + amount * 5
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
  }
  node.curve = curve
  node.oversample = "2x"
  return node
}

function articulationEnvelope(event: LinearScoreEventV2, track: LinearScoreTrackV2, legatoFromPrevious = false) {
  const duration = Math.max(0.03, event.durationSeconds)
  const articulation = event.articulation
  const attack = legatoFromPrevious
    ? 0.012
    : articulation === "staccato" || articulation === "accent"
      ? 0.018
      : articulation === "legato" ? 0.03 : Math.max(0.035, Math.min(0.12, track.attack * 0.75))
  const release = articulation === "staccato"
    ? Math.min(0.09, duration * 0.25)
    : articulation === "legato" ? Math.min(0.19, duration * 0.22) : Math.max(0.08, Math.min(0.32, track.release * 0.24))
  const sounding = articulation === "staccato" ? Math.min(duration, Math.max(0.09, duration * 0.56)) : duration
  const accent = articulation === "accent" ? 1.12 : articulation === "tenuto" ? 1.02 : 1
  return { attack, release, sounding, accent }
}

interface ModelProfile {
  reedMix: number
  noiseMix: number
  harmonic2: number
  harmonic3: number
  harmonic4: number
  brightnessBase: number
  resonances: readonly { ratio?: number; hz?: number; q: number; gain: number }[]
  vibratoRate: number
  boreFeedback: number
  boreDamping: number
  boreMix: number
  pressureWanderHz: number
}

function isContrabassoon(source: NativePhysicalModelSource) { return source.modelId === "double-reed-contrabassoon-v1" }

function profileFor(source: NativePhysicalModelSource): ModelProfile {
  if (isContrabassoon(source)) {
    return {
      reedMix: 0.82, noiseMix: 0.17, harmonic2: 0.38, harmonic3: 0.24, harmonic4: 0.1, brightnessBase: 1_850,
      resonances: [
        { ratio: 1, q: 2.8, gain: 0.5 }, { ratio: 2.01, q: 3.2, gain: 0.36 },
        { hz: 460, q: 2.4, gain: 0.31 }, { hz: 1_240, q: 2.8, gain: 0.23 },
        { hz: 2_450, q: 2.2, gain: 0.12 }, { hz: 4_100, q: 1.8, gain: 0.06 },
      ],
      vibratoRate: 4.65, boreFeedback: 0.78, boreDamping: 1_650, boreMix: 0.28, pressureWanderHz: 1.55,
    }
  }
  return {
    reedMix: 0.75, noiseMix: 0.2, harmonic2: 0.3, harmonic3: 0.2, harmonic4: 0.08, brightnessBase: 4_000,
    resonances: [
      { ratio: 1, q: 2.2, gain: 0.4 }, { ratio: 2.01, q: 3.0, gain: 0.28 },
      { hz: 900, q: 2.7, gain: 0.3 }, { hz: 1_750, q: 2.9, gain: 0.2 },
      { hz: 3_050, q: 2.4, gain: 0.13 }, { hz: 4_600, q: 1.8, gain: 0.07 },
    ],
    vibratoRate: 5.1, boreFeedback: 0.69, boreDamping: 3_900, boreMix: 0.23, pressureWanderHz: 1.8,
  }
}

function scheduleParam(param: AudioParam, at: number, value: number, rampSeconds: number, exponential = false) {
  const safe = exponential ? Math.max(1e-5, value) : value
  if (rampSeconds > 0) {
    if (exponential) param.exponentialRampToValueAtTime(safe, at + rampSeconds)
    else param.linearRampToValueAtTime(safe, at + rampSeconds)
  } else param.setValueAtTime(safe, at)
}

/**
 * Tloque reed-resonator v2.
 * Original acoustic model: nonlinear double-reed excitation drives a
 * formant/radiation network plus a damped waveguide. Performance controls are
 * scheduled continuously inside each note: expression changes pressure,
 * brightness changes bore/radiation damping, vibrato changes embouchure motion
 * and pitch-bend changes both excitation pitch and effective bore length.
 */
export function schedulePhysicalReedVoice(
  context: BaseAudioContext,
  source: NativePhysicalModelSource,
  options: PhysicalModelVoiceOptions,
) {
  const { event, track, midi, destination, startAt, controls = [], legatoFromPrevious = false } = options
  if (midi < source.midiMin || midi > source.midiMax) throw new Error(`${source.instrumentId}: MIDI ${midi} fuera del registro físico-modelado ${source.midiMin}-${source.midiMax}`)

  const profile = profileFor(source)
  const frequency = midiHz(midi)
  const pressure = clamp01(event.velocity * 0.72 + track.expression * 0.28)
  const brightness = clamp01(track.brightness)
  const vibrato = clamp01(track.vibrato)
  const envelope = articulationEnvelope(event, track, legatoFromPrevious)
  const noteStart = startAt + event.timeSeconds
  const noteEnd = noteStart + envelope.sounding
  const stopAt = noteEnd + envelope.release + 0.1

  const excitation = context.createGain(); excitation.gain.value = 1
  const pressureGain = context.createGain(); pressureGain.gain.value = 0.72 + pressure * 0.28
  const saturator = createSaturator(context, 0.22 + pressure * 0.5)
  excitation.connect(pressureGain); pressureGain.connect(saturator)

  const fundamental = context.createOscillator(); fundamental.type = "sawtooth"; fundamental.frequency.value = frequency
  const fundamentalGain = context.createGain(); fundamentalGain.gain.value = profile.reedMix * (0.58 + pressure * 0.42)
  fundamental.connect(fundamentalGain); fundamentalGain.connect(excitation)

  const harmonics: Array<[number, number]> = [[2, profile.harmonic2], [3, profile.harmonic3], [4, profile.harmonic4]]
  const harmonicOscillators: OscillatorNode[] = []
  for (const [multiple, level] of harmonics) {
    const oscillator = context.createOscillator(); oscillator.type = multiple === 2 ? "triangle" : "sine"; oscillator.frequency.value = frequency * multiple
    const gain = context.createGain(); gain.gain.value = level * (0.72 + pressure * 0.5)
    oscillator.connect(gain); gain.connect(excitation); harmonicOscillators.push(oscillator)
  }

  const noise = context.createBufferSource()
  noise.buffer = sharedDeterministicNoiseBuffer(context, `reed:${source.modelId}`, 8, 0.74)
  noise.loop = true
  const noiseBand = context.createBiquadFilter(); noiseBand.type = "bandpass"; noiseBand.frequency.value = isContrabassoon(source) ? 1_050 : 2_250; noiseBand.Q.value = 0.7
  const noiseGain = context.createGain(); noiseGain.gain.value = profile.noiseMix * (0.28 + pressure * 0.72)
  noise.connect(noiseBand); noiseBand.connect(noiseGain); noiseGain.connect(excitation)

  const boreDelay = context.createDelay(0.08)
  const baseDelaySeconds = Math.min(0.075, Math.max(1 / 18_000, 1 / frequency))
  boreDelay.delayTime.value = baseDelaySeconds
  const boreDamping = context.createBiquadFilter(); boreDamping.type = "lowpass"; boreDamping.frequency.value = profile.boreDamping * (0.76 + brightness * 0.46); boreDamping.Q.value = 0.35
  const boreFeedback = context.createGain(); boreFeedback.gain.value = profile.boreFeedback * (0.9 + pressure * 0.08)
  const boreTap = context.createGain(); boreTap.gain.value = profile.boreMix
  saturator.connect(boreDelay); boreDelay.connect(boreDamping); boreDamping.connect(boreFeedback); boreFeedback.connect(boreDelay)

  const boreBus = context.createGain(); boreBus.gain.value = 0.94
  boreDamping.connect(boreTap); boreTap.connect(boreBus)
  const dry = context.createGain(); dry.gain.value = legatoFromPrevious ? 0.1 : 0.14
  saturator.connect(dry); dry.connect(boreBus)
  for (const resonance of profile.resonances) {
    const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = Math.min(18_000, Math.max(45, resonance.hz ?? frequency * (resonance.ratio ?? 1))); filter.Q.value = resonance.q
    const gain = context.createGain(); gain.gain.value = resonance.gain
    saturator.connect(filter); filter.connect(gain); gain.connect(boreBus)
  }

  const radiation = context.createBiquadFilter(); radiation.type = "lowpass"; radiation.frequency.value = Math.min(15_000, profile.brightnessBase * (0.62 + brightness * 1.15) * (0.86 + pressure * 0.24)); radiation.Q.value = 0.7
  const output = context.createGain(); output.gain.value = 0
  boreBus.connect(radiation); radiation.connect(output); output.connect(destination)

  const lfo = context.createOscillator(); lfo.type = "sine"; lfo.frequency.value = profile.vibratoRate + vibrato * 0.5
  const lfoDepth = context.createGain(); lfoDepth.gain.value = vibrato * (isContrabassoon(source) ? 9 : 13)
  lfo.connect(lfoDepth); lfoDepth.connect(fundamental.detune); for (const oscillator of harmonicOscillators) lfoDepth.connect(oscillator.detune)
  const delayMod = context.createGain(); delayMod.gain.value = baseDelaySeconds * vibrato * 0.0045
  lfo.connect(delayMod); delayMod.connect(boreDelay.delayTime)

  const pressureLfo = context.createOscillator(); pressureLfo.type = "sine"; pressureLfo.frequency.value = profile.pressureWanderHz
  const pressureDepth = context.createGain(); pressureDepth.gain.value = 0.008 + pressure * 0.014
  pressureLfo.connect(pressureDepth); pressureDepth.connect(excitation.gain)

  // In-note automation. Controls before noteStart are already reflected by track;
  // only controls that occur while this voice is sounding are scheduled here.
  for (const control of controls) {
    if (control.trackId !== event.trackId || control.timeSeconds <= event.timeSeconds || control.timeSeconds > event.timeSeconds + envelope.sounding) continue
    const at = startAt + control.timeSeconds
    if (control.expression !== null) {
      const p = clamp01(event.velocity * 0.72 + control.expression * 0.28)
      scheduleParam(pressureGain.gain, at, 0.72 + p * 0.28, control.rampSeconds)
      scheduleParam(boreFeedback.gain, at, profile.boreFeedback * (0.9 + p * 0.08), control.rampSeconds)
      scheduleParam(noiseGain.gain, at, profile.noiseMix * (0.28 + p * 0.72), control.rampSeconds)
    }
    if (control.brightness !== null) {
      const b = clamp01(control.brightness)
      scheduleParam(boreDamping.frequency, at, profile.boreDamping * (0.76 + b * 0.46), control.rampSeconds, true)
      scheduleParam(radiation.frequency, at, Math.min(15_000, profile.brightnessBase * (0.62 + b * 1.15) * (0.86 + pressure * 0.24)), control.rampSeconds, true)
    }
    if (control.vibrato !== null) {
      const v = clamp01(control.vibrato)
      scheduleParam(lfoDepth.gain, at, v * (isContrabassoon(source) ? 9 : 13), control.rampSeconds)
      scheduleParam(delayMod.gain, at, baseDelaySeconds * v * 0.0045, control.rampSeconds)
    }
    if (control.pitchBend !== null) {
      const cents = centsForSemitones(control.pitchBend)
      scheduleParam(fundamental.detune, at, cents, control.rampSeconds)
      for (const oscillator of harmonicOscillators) scheduleParam(oscillator.detune, at, cents, control.rampSeconds)
      const bentFrequency = frequency * 2 ** (control.pitchBend / 12)
      scheduleParam(boreDelay.delayTime, at, Math.min(0.075, Math.max(1 / 18_000, 1 / bentFrequency)), control.rampSeconds)
    }
  }

  const peak = Math.min(0.86, (0.19 + pressure * 0.55) * envelope.accent)
  const initialPeak = legatoFromPrevious ? peak * 0.78 : peak
  output.gain.setValueAtTime(0.0001, noteStart)
  output.gain.exponentialRampToValueAtTime(Math.max(0.001, initialPeak), noteStart + envelope.attack)
  if (event.articulation === "accent") output.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.78), noteStart + Math.min(envelope.sounding * 0.32, envelope.attack + 0.08))
  output.gain.setValueAtTime(Math.max(0.001, peak * 0.78), Math.max(noteStart + envelope.attack, noteEnd - 0.015))
  output.gain.exponentialRampToValueAtTime(0.0001, stopAt)

  fundamental.start(noteStart); fundamental.stop(stopAt)
  for (const oscillator of harmonicOscillators) { oscillator.start(noteStart); oscillator.stop(stopAt) }
  const noiseOffset = deterministicNoiseOffset(`${source.modelId}:${event.trackId}:${event.timeSeconds}:${midi}`, noise.buffer.duration)
  noise.start(noteStart, noiseOffset); noise.stop(stopAt); lfo.start(noteStart); lfo.stop(stopAt); pressureLfo.start(noteStart); pressureLfo.stop(stopAt)

  return { startSeconds: event.timeSeconds, endSeconds: stopAt - startAt, sourceKind: source.kind }
}
