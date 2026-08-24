import type { NativeHybridSource } from "@shared/native-hybrid-source"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]
type LinearScoreControlV2 = LinearScoreRecipeV2["plan"]["controls"][number]

export interface AirColumnOverlayOptions {
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

function noiseBuffer(context: BaseAudioContext, seconds = 0.2) {
  const frames = Math.max(128, Math.ceil(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  let state = 0
  for (let i = 0; i < data.length; i += 1) {
    state = state * 0.72 + (Math.random() * 2 - 1) * 0.28
    data[i] = state
  }
  return buffer
}

function profileFor(source: NativeHybridSource) {
  const id = source.instrumentId
  if (id.startsWith("brass.")) {
    if (id === "brass.tuba" || id === "brass.bass-trombone") return { noise: 0.035, feedback: 0.86, damping: 1_900, harmonic2: 0.18, harmonic3: 0.11, formants: [320, 760, 1_450] }
    if (id === "brass.horn") return { noise: 0.03, feedback: 0.82, damping: 2_900, harmonic2: 0.2, harmonic3: 0.12, formants: [430, 980, 2_100] }
    return { noise: 0.028, feedback: 0.8, damping: 3_900, harmonic2: 0.24, harmonic3: 0.14, formants: [520, 1_250, 2_700] }
  }
  if (id === "woodwinds.flute") return { noise: 0.16, feedback: 0.68, damping: 6_200, harmonic2: 0.09, harmonic3: 0.045, formants: [900, 2_400, 4_600] }
  if (id === "woodwinds.clarinet" || id === "woodwinds.bass-clarinet") return { noise: 0.075, feedback: 0.76, damping: id.includes("bass-") ? 2_600 : 4_100, harmonic2: 0.06, harmonic3: 0.16, formants: id.includes("bass-") ? [420, 1_050, 2_300] : [760, 1_650, 3_200] }
  if (id === "woodwinds.bassoon") return { noise: 0.07, feedback: 0.8, damping: 2_450, harmonic2: 0.18, harmonic3: 0.13, formants: [470, 1_240, 2_500] }
  return { noise: 0.07, feedback: 0.75, damping: 4_500, harmonic2: 0.16, harmonic3: 0.11, formants: [850, 1_750, 3_100] }
}

/** Quiet physical overlay for sampled winds/brass. The sample owns identity and attack. */
export function scheduleAirColumnOverlay(context: BaseAudioContext, source: NativeHybridSource, options: AirColumnOverlayOptions) {
  const { startAt, event, track, midi, destination, controls = [], legatoFromPrevious = false } = options
  if (midi < source.midiMin || midi > source.midiMax) return null
  const profile = profileFor(source)
  const hz = midiHz(midi)
  const start = startAt + event.timeSeconds
  const duration = Math.max(0.04, event.durationSeconds)
  const release = event.articulation === "legato" ? 0.2 : 0.12
  const stop = start + duration + release
  const pressure = clamp01(event.velocity * 0.64 + track.expression * 0.36)
  const brightness = clamp01(track.brightness)
  const vibrato = clamp01(track.vibrato)

  const excitation = context.createGain(); excitation.gain.value = 1
  const pressureGain = context.createGain(); pressureGain.gain.value = 0.5 + pressure * 0.5
  excitation.connect(pressureGain)

  const fundamental = context.createOscillator(); fundamental.type = source.instrumentId.startsWith("brass.") ? "sawtooth" : "triangle"; fundamental.frequency.value = hz
  const fundamentalGain = context.createGain(); fundamentalGain.gain.value = 0.14 + pressure * 0.1
  fundamental.connect(fundamentalGain); fundamentalGain.connect(excitation)

  const h2 = context.createOscillator(); h2.type = "sine"; h2.frequency.value = hz * 2
  const h2g = context.createGain(); h2g.gain.value = profile.harmonic2 * (0.7 + pressure * 0.3)
  h2.connect(h2g); h2g.connect(excitation)
  const h3 = context.createOscillator(); h3.type = "sine"; h3.frequency.value = hz * 3
  const h3g = context.createGain(); h3g.gain.value = profile.harmonic3 * (0.72 + brightness * 0.28)
  h3.connect(h3g); h3g.connect(excitation)

  const breath = context.createBufferSource(); breath.buffer = noiseBuffer(context); breath.loop = true
  const breathBand = context.createBiquadFilter(); breathBand.type = "bandpass"; breathBand.frequency.value = profile.damping * (0.55 + brightness * 0.5); breathBand.Q.value = 0.65
  const breathGain = context.createGain(); breathGain.gain.value = profile.noise * (0.4 + pressure * 0.6)
  breath.connect(breathBand); breathBand.connect(breathGain); breathGain.connect(excitation)

  const delay = context.createDelay(0.09)
  const baseDelay = Math.min(0.08, Math.max(1 / 18_000, 1 / hz))
  delay.delayTime.value = baseDelay
  const damping = context.createBiquadFilter(); damping.type = "lowpass"; damping.frequency.value = profile.damping * (0.72 + brightness * 0.5); damping.Q.value = 0.25
  const feedback = context.createGain(); feedback.gain.value = profile.feedback * (0.93 + pressure * 0.05)
  excitation.connect(delay); delay.connect(damping); damping.connect(feedback); feedback.connect(delay)

  const bus = context.createGain(); bus.gain.value = 1
  const tap = context.createGain(); tap.gain.value = 0.24
  damping.connect(tap); tap.connect(bus)
  for (const frequency of profile.formants) {
    const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = frequency; filter.Q.value = 2.1
    const gain = context.createGain(); gain.gain.value = 0.095
    damping.connect(filter); filter.connect(gain); gain.connect(bus)
  }

  const output = context.createGain(); output.gain.value = 0
  bus.connect(output); output.connect(destination)

  const lfo = context.createOscillator(); lfo.type = "sine"; lfo.frequency.value = source.instrumentId.startsWith("brass.") ? 5.0 : 5.2
  const lfoDepth = context.createGain(); lfoDepth.gain.value = vibrato * (source.instrumentId.includes("bass-") || source.instrumentId === "brass.tuba" ? 6 : 10)
  lfo.connect(lfoDepth); lfoDepth.connect(fundamental.detune); lfoDepth.connect(h2.detune); lfoDepth.connect(h3.detune)
  const delayMod = context.createGain(); delayMod.gain.value = baseDelay * vibrato * 0.003
  lfo.connect(delayMod); delayMod.connect(delay.delayTime)

  for (const control of controls) {
    if (control.trackId !== event.trackId || control.timeSeconds <= event.timeSeconds || control.timeSeconds > event.timeSeconds + duration) continue
    const at = startAt + control.timeSeconds
    if (control.expression !== null) {
      const p = clamp01(event.velocity * 0.64 + control.expression * 0.36)
      scheduleParam(pressureGain.gain, at, 0.5 + p * 0.5, control.rampSeconds)
      scheduleParam(feedback.gain, at, profile.feedback * (0.93 + p * 0.05), control.rampSeconds)
      scheduleParam(breathGain.gain, at, profile.noise * (0.4 + p * 0.6), control.rampSeconds)
    }
    if (control.brightness !== null) {
      const b = clamp01(control.brightness)
      scheduleParam(damping.frequency, at, profile.damping * (0.72 + b * 0.5), control.rampSeconds, true)
      scheduleParam(breathBand.frequency, at, profile.damping * (0.55 + b * 0.5), control.rampSeconds, true)
    }
    if (control.vibrato !== null) scheduleParam(lfoDepth.gain, at, clamp01(control.vibrato) * (source.instrumentId.includes("bass-") || source.instrumentId === "brass.tuba" ? 6 : 10), control.rampSeconds)
    if (control.pitchBend !== null) {
      const cents = control.pitchBend * 100
      scheduleParam(fundamental.detune, at, cents, control.rampSeconds); scheduleParam(h2.detune, at, cents, control.rampSeconds); scheduleParam(h3.detune, at, cents, control.rampSeconds)
      const bentHz = hz * 2 ** (control.pitchBend / 12)
      scheduleParam(delay.delayTime, at, Math.min(0.08, Math.max(1 / 18_000, 1 / bentHz)), control.rampSeconds)
    }
  }

  const attack = legatoFromPrevious ? 0.009 : Math.max(0.016, Math.min(0.065, track.attack * 0.35))
  const peak = source.wet * (0.68 + pressure * 0.32)
  output.gain.setValueAtTime(0.0001, start)
  output.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), start + attack)
  output.gain.setValueAtTime(Math.max(0.001, peak * 0.9), Math.max(start + attack, start + duration - 0.012))
  output.gain.exponentialRampToValueAtTime(0.0001, stop)

  fundamental.start(start); fundamental.stop(stop); h2.start(start); h2.stop(stop); h3.start(start); h3.stop(stop); breath.start(start); breath.stop(stop); lfo.start(start); lfo.stop(stop)
  return { endSeconds: event.timeSeconds + duration + release }
}
