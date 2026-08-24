import type { NativeHybridSource } from "@shared/native-hybrid-source"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]

export interface BowedStringOverlayOptions {
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
function scheduleParam(param: AudioParam, at: number, value: number, rampSeconds: number, exponential = false) {
  const safe = exponential ? Math.max(1e-5, value) : value
  if (rampSeconds > 0) {
    if (exponential) param.exponentialRampToValueAtTime(safe, at + rampSeconds)
    else param.linearRampToValueAtTime(safe, at + rampSeconds)
  } else param.setValueAtTime(safe, at)
}

function profileFor(source: NativeHybridSource) {
  if (source.instrumentId === "strings.contrabass") return { body: [88, 176, 286], bodyQ: 2.1, bowNoise: 0.13, brightness: 2_200, delayMix: 0.3, feedback: 0.84 }
  if (source.instrumentId === "strings.cello") return { body: [118, 238, 410], bodyQ: 2.35, bowNoise: 0.12, brightness: 3_300, delayMix: 0.27, feedback: 0.81 }
  if (source.instrumentId === "strings.viola") return { body: [196, 392, 710], bodyQ: 2.55, bowNoise: 0.105, brightness: 4_500, delayMix: 0.24, feedback: 0.78 }
  return { body: [278, 552, 980], bodyQ: 2.8, bowNoise: 0.095, brightness: 5_800, delayMix: 0.22, feedback: 0.75 }
}

function noiseBuffer(context: BaseAudioContext, seconds = 0.18) {
  const frames = Math.max(128, Math.ceil(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1
    last = last * 0.68 + white * 0.32
    data[i] = last
  }
  return buffer
}

/**
 * Hybrid Strings v1.
 * This layer is intentionally quieter than the sampled source. It models
 * continuous bow friction, string feedback and body resonances so dynamics and
 * legato can move between recorded sample states without replacing their real attack/timbre.
 */
export function scheduleBowedStringOverlay(
  context: BaseAudioContext,
  source: NativeHybridSource,
  options: BowedStringOverlayOptions,
) {
  const { event, track, midi, destination, startAt, controls = [], legatoFromPrevious = false } = options
  if (midi < source.midiMin || midi > source.midiMax) return null
  const profile = profileFor(source)
  const hz = midiHz(midi)
  const start = startAt + event.timeSeconds
  const duration = Math.max(0.04, event.durationSeconds)
  const release = event.articulation === "legato" ? 0.22 : 0.14
  const stop = start + duration + release
  const pressure = clamp01(event.velocity * 0.62 + track.expression * 0.38)
  const brightness = clamp01(track.brightness)
  const vibrato = clamp01(track.vibrato)

  const excitation = context.createGain(); excitation.gain.value = 1
  const bowPressure = context.createGain(); bowPressure.gain.value = 0.45 + pressure * 0.55
  excitation.connect(bowPressure)

  const fundamental = context.createOscillator(); fundamental.type = "sawtooth"; fundamental.frequency.value = hz
  const core = context.createGain(); core.gain.value = 0.18 + pressure * 0.18
  fundamental.connect(core); core.connect(excitation)

  const harmonic = context.createOscillator(); harmonic.type = "triangle"; harmonic.frequency.value = hz * 2
  const harmonicGain = context.createGain(); harmonicGain.gain.value = 0.055 + brightness * 0.05
  harmonic.connect(harmonicGain); harmonicGain.connect(excitation)

  const bow = context.createBufferSource(); bow.buffer = noiseBuffer(context); bow.loop = true
  const bowBand = context.createBiquadFilter(); bowBand.type = "bandpass"; bowBand.frequency.value = profile.brightness * (0.62 + brightness * 0.72); bowBand.Q.value = 0.65
  const bowGain = context.createGain(); bowGain.gain.value = profile.bowNoise * (0.42 + pressure * 0.58)
  bow.connect(bowBand); bowBand.connect(bowGain); bowGain.connect(excitation)

  const waveguide = context.createDelay(0.09)
  const baseDelay = Math.min(0.08, Math.max(1 / 18_000, 1 / hz))
  waveguide.delayTime.value = baseDelay
  const damping = context.createBiquadFilter(); damping.type = "lowpass"; damping.frequency.value = profile.brightness * (0.75 + brightness * 0.45); damping.Q.value = 0.28
  const feedback = context.createGain(); feedback.gain.value = profile.feedback * (0.92 + pressure * 0.06)
  excitation.connect(waveguide); waveguide.connect(damping); damping.connect(feedback); feedback.connect(waveguide)

  const bodyBus = context.createGain(); bodyBus.gain.value = 1
  const delayTap = context.createGain(); delayTap.gain.value = profile.delayMix
  damping.connect(delayTap); delayTap.connect(bodyBus)
  for (const frequency of profile.body) {
    const resonance = context.createBiquadFilter(); resonance.type = "bandpass"; resonance.frequency.value = frequency; resonance.Q.value = profile.bodyQ
    const gain = context.createGain(); gain.gain.value = 0.13
    damping.connect(resonance); resonance.connect(gain); gain.connect(bodyBus)
  }

  const air = context.createBiquadFilter(); air.type = "lowpass"; air.frequency.value = profile.brightness * (0.72 + brightness * 0.72); air.Q.value = 0.4
  const output = context.createGain(); output.gain.value = 0
  bodyBus.connect(air); air.connect(output); output.connect(destination)

  const lfo = context.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 5.1
  const lfoDepth = context.createGain(); lfoDepth.gain.value = vibrato * (source.instrumentId === "strings.contrabass" ? 7 : 13)
  lfo.connect(lfoDepth); lfoDepth.connect(fundamental.detune); lfoDepth.connect(harmonic.detune)
  const delayMod = context.createGain(); delayMod.gain.value = baseDelay * vibrato * 0.0035
  lfo.connect(delayMod); delayMod.connect(waveguide.delayTime)

  for (const control of controls) {
    if (control.trackId !== event.trackId || control.timeSeconds <= event.timeSeconds || control.timeSeconds > event.timeSeconds + duration) continue
    const at = startAt + control.timeSeconds
    if (control.expression !== null) {
      const p = clamp01(event.velocity * 0.62 + control.expression * 0.38)
      scheduleParam(bowPressure.gain, at, 0.45 + p * 0.55, control.rampSeconds)
      scheduleParam(feedback.gain, at, profile.feedback * (0.92 + p * 0.06), control.rampSeconds)
      scheduleParam(bowGain.gain, at, profile.bowNoise * (0.42 + p * 0.58), control.rampSeconds)
    }
    if (control.brightness !== null) {
      const b = clamp01(control.brightness)
      scheduleParam(damping.frequency, at, profile.brightness * (0.75 + b * 0.45), control.rampSeconds, true)
      scheduleParam(air.frequency, at, profile.brightness * (0.72 + b * 0.72), control.rampSeconds, true)
      scheduleParam(bowBand.frequency, at, profile.brightness * (0.62 + b * 0.72), control.rampSeconds, true)
    }
    if (control.vibrato !== null) scheduleParam(lfoDepth.gain, at, clamp01(control.vibrato) * (source.instrumentId === "strings.contrabass" ? 7 : 13), control.rampSeconds)
    if (control.pitchBend !== null) {
      const cents = control.pitchBend * 100
      scheduleParam(fundamental.detune, at, cents, control.rampSeconds)
      scheduleParam(harmonic.detune, at, cents, control.rampSeconds)
      const bentHz = hz * 2 ** (control.pitchBend / 12)
      scheduleParam(waveguide.delayTime, at, Math.min(0.08, Math.max(1 / 18_000, 1 / bentHz)), control.rampSeconds)
    }
  }

  const attack = legatoFromPrevious ? 0.01 : Math.max(0.018, Math.min(0.075, track.attack * 0.42))
  const peak = source.wet * (0.66 + pressure * 0.34)
  output.gain.setValueAtTime(0.0001, start)
  output.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), start + attack)
  output.gain.setValueAtTime(Math.max(0.001, peak * 0.9), Math.max(start + attack, start + duration - 0.012))
  output.gain.exponentialRampToValueAtTime(0.0001, stop)

  fundamental.start(start); fundamental.stop(stop)
  harmonic.start(start); harmonic.stop(stop)
  bow.start(start); bow.stop(stop)
  lfo.start(start); lfo.stop(stop)
  return { endSeconds: event.timeSeconds + duration + release }
}
