import type { NativePhysicalModelSource } from "@shared/native-acoustic-source"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]

export interface PhysicalModelVoiceOptions {
  startAt: number
  event: LinearScoreEventV2
  track: LinearScoreTrackV2
  midi: number
  destination: AudioNode
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function midiHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12) }

function makeNoiseBuffer(context: BaseAudioContext, seconds = 0.2) {
  const frames = Math.max(128, Math.ceil(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  let previous = 0
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1
    previous = previous * 0.74 + white * 0.26
    data[i] = previous
  }
  return buffer
}

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

function articulationEnvelope(event: LinearScoreEventV2, track: LinearScoreTrackV2) {
  const duration = Math.max(0.03, event.durationSeconds)
  const articulation = event.articulation
  const attack = articulation === "staccato" || articulation === "accent"
    ? 0.018
    : articulation === "legato" ? 0.035 : Math.max(0.035, Math.min(0.12, track.attack * 0.75))
  const release = articulation === "staccato"
    ? Math.min(0.09, duration * 0.25)
    : articulation === "legato" ? Math.min(0.16, duration * 0.18) : Math.max(0.08, Math.min(0.32, track.release * 0.24))
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

function profileFor(source: NativePhysicalModelSource): ModelProfile {
  if (source.modelId === "double-reed-contrabassoon-v1") {
    return {
      reedMix: 0.82,
      noiseMix: 0.17,
      harmonic2: 0.38,
      harmonic3: 0.24,
      harmonic4: 0.1,
      brightnessBase: 1_850,
      resonances: [
        { ratio: 1, q: 2.8, gain: 0.5 },
        { ratio: 2.01, q: 3.2, gain: 0.36 },
        { hz: 460, q: 2.4, gain: 0.31 },
        { hz: 1_240, q: 2.8, gain: 0.23 },
        { hz: 2_450, q: 2.2, gain: 0.12 },
        { hz: 4_100, q: 1.8, gain: 0.06 },
      ],
      vibratoRate: 4.65,
      boreFeedback: 0.78,
      boreDamping: 1_650,
      boreMix: 0.28,
      pressureWanderHz: 1.55,
    }
  }
  return {
    reedMix: 0.75,
    noiseMix: 0.2,
    harmonic2: 0.3,
    harmonic3: 0.2,
    harmonic4: 0.08,
    brightnessBase: 4_000,
    resonances: [
      { ratio: 1, q: 2.2, gain: 0.4 },
      { ratio: 2.01, q: 3.0, gain: 0.28 },
      { hz: 900, q: 2.7, gain: 0.3 },
      { hz: 1_750, q: 2.9, gain: 0.2 },
      { hz: 3_050, q: 2.4, gain: 0.13 },
      { hz: 4_600, q: 1.8, gain: 0.07 },
    ],
    vibratoRate: 5.1,
    boreFeedback: 0.69,
    boreDamping: 3_900,
    boreMix: 0.23,
    pressureWanderHz: 1.8,
  }
}

/**
 * Tloque reed-resonator v1.
 *
 * Original acoustic model: nonlinear double-reed excitation drives both a
 * formant/radiation network and a damped feedback delay representing the air
 * column. Velocity/expression alter pressure and harmonic content continuously;
 * the model never crossfades discrete recorded pitches. Studio-approved only
 * until calibrated against legally usable acoustic references for Master.
 */
export function schedulePhysicalReedVoice(
  context: AudioContext,
  source: NativePhysicalModelSource,
  options: PhysicalModelVoiceOptions,
) {
  const { event, track, midi, destination, startAt } = options
  if (midi < source.midiMin || midi > source.midiMax) throw new Error(`${source.instrumentId}: MIDI ${midi} fuera del registro físico-modelado ${source.midiMin}-${source.midiMax}`)

  const profile = profileFor(source)
  const frequency = midiHz(midi)
  const pressure = clamp01(event.velocity * 0.72 + track.expression * 0.28)
  const brightness = clamp01(track.brightness)
  const vibrato = clamp01(track.vibrato)
  const envelope = articulationEnvelope(event, track)
  const noteStart = startAt + event.timeSeconds
  const noteEnd = noteStart + envelope.sounding
  const stopAt = noteEnd + envelope.release + 0.1

  const excitation = context.createGain(); excitation.gain.value = 1
  const saturator = createSaturator(context, 0.22 + pressure * 0.5)
  excitation.connect(saturator)

  const fundamental = context.createOscillator()
  fundamental.type = "sawtooth"
  fundamental.frequency.value = frequency
  const fundamentalGain = context.createGain()
  fundamentalGain.gain.value = profile.reedMix * (0.58 + pressure * 0.42)
  fundamental.connect(fundamentalGain); fundamentalGain.connect(excitation)

  const harmonics: Array<[number, number]> = [[2, profile.harmonic2], [3, profile.harmonic3], [4, profile.harmonic4]]
  const harmonicOscillators: OscillatorNode[] = []
  for (const [multiple, level] of harmonics) {
    const oscillator = context.createOscillator()
    oscillator.type = multiple === 2 ? "triangle" : "sine"
    oscillator.frequency.value = frequency * multiple
    const gain = context.createGain(); gain.gain.value = level * (0.72 + pressure * 0.5)
    oscillator.connect(gain); gain.connect(excitation)
    harmonicOscillators.push(oscillator)
  }

  const noise = context.createBufferSource()
  noise.buffer = makeNoiseBuffer(context)
  noise.loop = true
  const noiseBand = context.createBiquadFilter()
  noiseBand.type = "bandpass"
  noiseBand.frequency.value = source.modelId === "double-reed-contrabassoon-v1" ? 1_050 : 2_250
  noiseBand.Q.value = 0.7
  const noiseGain = context.createGain(); noiseGain.gain.value = profile.noiseMix * (0.28 + pressure * 0.72)
  noise.connect(noiseBand); noiseBand.connect(noiseGain); noiseGain.connect(excitation)

  // Air-column waveguide. A delay of one period establishes the playable
  // resonance; damping and sub-unity feedback keep the loop passive/stable.
  const boreDelay = context.createDelay(0.08)
  const baseDelaySeconds = Math.min(0.075, Math.max(1 / 18_000, 1 / frequency))
  boreDelay.delayTime.value = baseDelaySeconds
  const boreDamping = context.createBiquadFilter(); boreDamping.type = "lowpass"; boreDamping.frequency.value = profile.boreDamping * (0.76 + brightness * 0.46); boreDamping.Q.value = 0.35
  const boreFeedback = context.createGain(); boreFeedback.gain.value = profile.boreFeedback * (0.9 + pressure * 0.08)
  const boreTap = context.createGain(); boreTap.gain.value = profile.boreMix
  saturator.connect(boreDelay)
  boreDelay.connect(boreDamping)
  boreDamping.connect(boreFeedback); boreFeedback.connect(boreDelay)

  const boreBus = context.createGain(); boreBus.gain.value = 0.94
  boreDamping.connect(boreTap); boreTap.connect(boreBus)
  const dry = context.createGain(); dry.gain.value = 0.14
  saturator.connect(dry); dry.connect(boreBus)
  for (const resonance of profile.resonances) {
    const filter = context.createBiquadFilter()
    filter.type = "bandpass"
    filter.frequency.value = Math.min(18_000, Math.max(45, resonance.hz ?? frequency * (resonance.ratio ?? 1)))
    filter.Q.value = resonance.q
    const gain = context.createGain(); gain.gain.value = resonance.gain
    saturator.connect(filter); filter.connect(gain); gain.connect(boreBus)
  }

  const radiation = context.createBiquadFilter()
  radiation.type = "lowpass"
  radiation.frequency.value = Math.min(15_000, profile.brightnessBase * (0.62 + brightness * 1.15) * (0.86 + pressure * 0.24))
  radiation.Q.value = 0.7
  const output = context.createGain(); output.gain.value = 0
  boreBus.connect(radiation); radiation.connect(output); output.connect(destination)

  // Embouchure vibrato moves both excitation pitch and the effective bore length.
  const lfo = context.createOscillator(); lfo.type = "sine"; lfo.frequency.value = profile.vibratoRate + vibrato * 0.5
  const lfoDepth = context.createGain(); lfoDepth.gain.value = vibrato * (source.modelId === "double-reed-contrabassoon-v1" ? 9 : 13)
  lfo.connect(lfoDepth); lfoDepth.connect(fundamental.detune)
  for (const oscillator of harmonicOscillators) lfoDepth.connect(oscillator.detune)
  const delayMod = context.createGain(); delayMod.gain.value = baseDelaySeconds * vibrato * 0.0045
  lfo.connect(delayMod); delayMod.connect(boreDelay.delayTime)

  // Slow breath/embouchure wander avoids a static, frozen excitation while
  // remaining subtle enough not to become an audible tremolo effect.
  const pressureLfo = context.createOscillator(); pressureLfo.type = "sine"; pressureLfo.frequency.value = profile.pressureWanderHz
  const pressureDepth = context.createGain(); pressureDepth.gain.value = 0.008 + pressure * 0.014
  pressureLfo.connect(pressureDepth); pressureDepth.connect(excitation.gain)

  const peak = Math.min(0.86, (0.19 + pressure * 0.55) * envelope.accent)
  output.gain.setValueAtTime(0.0001, noteStart)
  output.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), noteStart + envelope.attack)
  if (event.articulation === "accent") {
    output.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.78), noteStart + Math.min(envelope.sounding * 0.32, envelope.attack + 0.08))
  }
  output.gain.setValueAtTime(Math.max(0.001, peak * 0.78), Math.max(noteStart + envelope.attack, noteEnd - 0.015))
  output.gain.exponentialRampToValueAtTime(0.0001, stopAt)

  fundamental.start(noteStart); fundamental.stop(stopAt)
  for (const oscillator of harmonicOscillators) { oscillator.start(noteStart); oscillator.stop(stopAt) }
  noise.start(noteStart); noise.stop(stopAt)
  lfo.start(noteStart); lfo.stop(stopAt)
  pressureLfo.start(noteStart); pressureLfo.stop(stopAt)

  return { startSeconds: event.timeSeconds, endSeconds: stopAt - startAt, sourceKind: source.kind }
}
