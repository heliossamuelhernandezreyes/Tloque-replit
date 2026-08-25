import type { NativeHybridSource } from "@shared/native-hybrid-source"
import { boundedHybridCalibrationTuning, type HybridCalibrationTuning } from "@shared/native-hybrid-tuning"
import { physicalPerformanceStateAt } from "@shared/physical-performance-control"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { scheduleSympatheticResonanceOverlay } from "./PhysicalSympatheticResonanceOverlay"

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
  calibrationTuning?: HybridCalibrationTuning
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)) }
function midiHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12) }
function scheduleParam(param: AudioParam, at: number, value: number, rampSeconds: number, exponential = false) {
  const safe = exponential ? Math.max(1e-5, value) : value
  if (rampSeconds > 0) exponential ? param.exponentialRampToValueAtTime(safe, at + rampSeconds) : param.linearRampToValueAtTime(safe, at + rampSeconds)
  else param.setValueAtTime(safe, at)
}
function noiseBuffer(context: BaseAudioContext, seconds = 0.2) {
  const buffer = context.createBuffer(1, Math.max(128, Math.ceil(context.sampleRate * seconds)), context.sampleRate)
  const data = buffer.getChannelData(0); let state = 0
  for (let i = 0; i < data.length; i += 1) { state = state * 0.72 + (Math.random() * 2 - 1) * 0.28; data[i] = state }
  return buffer
}
function profileFor(source: NativeHybridSource) {
  const id = source.instrumentId
  if (id.startsWith("brass.")) {
    if (id === "brass.tuba" || id === "brass.bass-trombone") return { noise: 0.035, feedback: 0.86, damping: 1_900, h2: 0.18, h3: 0.11, formants: [320, 760, 1_450] }
    if (id === "brass.horn") return { noise: 0.03, feedback: 0.82, damping: 2_900, h2: 0.2, h3: 0.12, formants: [430, 980, 2_100] }
    return { noise: 0.028, feedback: 0.8, damping: 3_900, h2: 0.24, h3: 0.14, formants: [520, 1_250, 2_700] }
  }
  if (id === "woodwinds.flute" || id === "woodwinds.piccolo") return { noise: id.endsWith("piccolo") ? 0.13 : 0.16, feedback: 0.68, damping: id.endsWith("piccolo") ? 7_400 : 6_200, h2: 0.09, h3: 0.045, formants: [900, 2_400, 4_600] }
  if (id === "woodwinds.clarinet" || id === "woodwinds.bass-clarinet") return { noise: 0.075, feedback: 0.76, damping: id.includes("bass-") ? 2_600 : 4_100, h2: 0.06, h3: 0.16, formants: id.includes("bass-") ? [420, 1_050, 2_300] : [760, 1_650, 3_200] }
  if (id === "woodwinds.bassoon") return { noise: 0.07, feedback: 0.8, damping: 2_450, h2: 0.18, h3: 0.13, formants: [470, 1_240, 2_500] }
  return { noise: 0.07, feedback: 0.75, damping: 4_500, h2: 0.16, h3: 0.11, formants: [850, 1_750, 3_100] }
}

function brightnessAt(track: LinearScoreTrackV2, controls: readonly LinearScoreControlV2[], timeSeconds: number) {
  let brightness = clamp01(track.brightness)
  for (const control of controls) if (control.trackId === track.id && control.timeSeconds <= timeSeconds && control.brightness !== null) brightness = clamp01(control.brightness)
  return brightness
}
function pressureFor(velocity: number, pressure: number) { return clamp01(velocity * 0.44 + pressure * 0.56) }
function embouchureTone(embouchure: number) { return 0.78 + embouchure * 0.42 }
function embouchureFeedback(embouchure: number) { return 0.94 + (1 - Math.abs(embouchure - 0.5) * 2) * 0.06 }
function wetGainFor(source: NativeHybridSource, pressure: number, embouchure: number, wetScale: number) { return Math.max(0.001, source.wet * wetScale * (0.65 + pressure * 0.3 + embouchure * 0.05)) }

/** Air-column overlay v1.2: continuous pressure, embouchure, formant and harmonic automation. */
export function scheduleAirColumnOverlay(context: BaseAudioContext, source: NativeHybridSource, options: AirColumnOverlayOptions) {
  if (source.physicalLayer === "sympathetic-resonance") return scheduleSympatheticResonanceOverlay(context, source, options)
  const { startAt, event, track, midi, destination, controls = [], legatoFromPrevious = false } = options
  if (midi < source.midiMin || midi > source.midiMax) return null
  const tuning = boundedHybridCalibrationTuning(options.calibrationTuning)
  const profile = profileFor(source), state0 = physicalPerformanceStateAt(track, controls, event.timeSeconds), hz = midiHz(midi), start = startAt + event.timeSeconds
  const duration = Math.max(0.04, event.durationSeconds), releaseBase = event.articulation === "legato" ? 0.2 : 0.12, release = releaseBase * tuning.decayScale, stop = start + duration + release
  const pressure = pressureFor(event.velocity, state0.pressure), embouchure = state0.embouchure, brightness = brightnessAt(track, controls, event.timeSeconds), vibrato = clamp01(track.vibrato)

  const excitation = context.createGain(), pressureGain = context.createGain(); excitation.gain.value = 1; pressureGain.gain.value = 0.46 + pressure * 0.54; excitation.connect(pressureGain)
  const fundamental = context.createOscillator(), fg = context.createGain(); fundamental.type = source.instrumentId.startsWith("brass.") ? "sawtooth" : "triangle"; fundamental.frequency.value = hz; fg.gain.value = 0.13 + pressure * 0.11; fundamental.connect(fg); fg.connect(excitation)
  const h2 = context.createOscillator(), h2g = context.createGain(); h2.type = "sine"; h2.frequency.value = hz * 2; h2g.gain.value = profile.h2 * (0.68 + pressure * 0.32) * embouchureTone(embouchure) * tuning.textureScale; h2.connect(h2g); h2g.connect(excitation)
  const h3 = context.createOscillator(), h3g = context.createGain(); h3.type = "sine"; h3.frequency.value = hz * 3; h3g.gain.value = profile.h3 * (0.7 + brightness * 0.24 + embouchure * 0.12) * tuning.textureScale; h3.connect(h3g); h3g.connect(excitation)
  const breath = context.createBufferSource(), breathBand = context.createBiquadFilter(), breathGain = context.createGain(); breath.buffer = noiseBuffer(context); breath.loop = true; breathBand.type = "bandpass"; breathBand.frequency.value = profile.damping * tuning.dampingScale * (0.48 + brightness * 0.35 + embouchure * 0.28); breathBand.Q.value = 0.65; breathGain.gain.value = profile.noise * (0.35 + pressure * 0.65) * (1.1 - embouchure * 0.16) * tuning.textureScale; breath.connect(breathBand); breathBand.connect(breathGain); breathGain.connect(excitation)

  const delay = context.createDelay(0.09), damping = context.createBiquadFilter(), feedback = context.createGain(); const baseDelay = Math.min(0.08, Math.max(1 / 18_000, 1 / hz)); delay.delayTime.value = baseDelay; damping.type = "lowpass"; damping.frequency.value = profile.damping * tuning.dampingScale * (0.64 + brightness * 0.35 + embouchure * 0.28); damping.Q.value = 0.25; feedback.gain.value = profile.feedback * tuning.feedbackScale * (0.91 + pressure * 0.055) * embouchureFeedback(embouchure); excitation.connect(delay); delay.connect(damping); damping.connect(feedback); feedback.connect(delay)
  const bus = context.createGain(), tap = context.createGain(); bus.gain.value = 1; tap.gain.value = 0.24 * tuning.bodyScale; damping.connect(tap); tap.connect(bus)
  const formantFilters: BiquadFilterNode[] = []
  for (const frequency of profile.formants) {
    const filter = context.createBiquadFilter(), gain = context.createGain(); filter.type = "bandpass"; filter.frequency.value = frequency * (0.94 + embouchure * 0.12); filter.Q.value = 2.1; gain.gain.value = 0.095 * tuning.bodyScale; damping.connect(filter); filter.connect(gain); gain.connect(bus); formantFilters.push(filter)
  }
  const output = context.createGain(); output.gain.value = 0; bus.connect(output); output.connect(destination)

  const lfo = context.createOscillator(), lfoDepth = context.createGain(), delayMod = context.createGain(); lfo.type = "sine"; lfo.frequency.value = source.instrumentId.startsWith("brass.") ? 5 : 5.2; const vibratoCents = source.instrumentId.includes("bass-") || source.instrumentId === "brass.tuba" ? 6 : 10; lfoDepth.gain.value = vibrato * vibratoCents; lfo.connect(lfoDepth); lfoDepth.connect(fundamental.detune); lfoDepth.connect(h2.detune); lfoDepth.connect(h3.detune); delayMod.gain.value = baseDelay * vibrato * 0.003; lfo.connect(delayMod); delayMod.connect(delay.delayTime)

  const attack = legatoFromPrevious ? 0.009 : Math.max(0.016, Math.min(0.065, track.attack * 0.35))
  output.gain.setValueAtTime(0.0001, start); output.gain.exponentialRampToValueAtTime(wetGainFor(source, pressure, embouchure, tuning.wetScale), start + attack)

  for (const control of controls) {
    if (control.trackId !== event.trackId || control.timeSeconds <= event.timeSeconds || control.timeSeconds > event.timeSeconds + duration) continue
    const at = startAt + control.timeSeconds, state = physicalPerformanceStateAt(track, controls, control.timeSeconds)
    const p = pressureFor(event.velocity, state.pressure), e = state.embouchure, b = brightnessAt(track, controls, control.timeSeconds)
    scheduleParam(pressureGain.gain, at, 0.46 + p * 0.54, control.rampSeconds)
    scheduleParam(fg.gain, at, 0.13 + p * 0.11, control.rampSeconds)
    scheduleParam(h2g.gain, at, profile.h2 * (0.68 + p * 0.32) * embouchureTone(e) * tuning.textureScale, control.rampSeconds)
    scheduleParam(h3g.gain, at, profile.h3 * (0.7 + b * 0.24 + e * 0.12) * tuning.textureScale, control.rampSeconds)
    scheduleParam(feedback.gain, at, profile.feedback * tuning.feedbackScale * (0.91 + p * 0.055) * embouchureFeedback(e), control.rampSeconds)
    scheduleParam(breathGain.gain, at, profile.noise * (0.35 + p * 0.65) * (1.1 - e * 0.16) * tuning.textureScale, control.rampSeconds)
    scheduleParam(damping.frequency, at, profile.damping * tuning.dampingScale * (0.64 + b * 0.35 + e * 0.28), control.rampSeconds, true)
    scheduleParam(breathBand.frequency, at, profile.damping * tuning.dampingScale * (0.48 + b * 0.35 + e * 0.28), control.rampSeconds, true)
    for (let i = 0; i < formantFilters.length; i += 1) scheduleParam(formantFilters[i].frequency, at, profile.formants[i] * (0.94 + e * 0.12), control.rampSeconds, true)
    scheduleParam(output.gain, at, wetGainFor(source, p, e, tuning.wetScale), control.rampSeconds, true)
    if (control.vibrato !== null) scheduleParam(lfoDepth.gain, at, clamp01(control.vibrato) * vibratoCents, control.rampSeconds)
    if (control.pitchBend !== null) { const cents = control.pitchBend * 100; scheduleParam(fundamental.detune, at, cents, control.rampSeconds); scheduleParam(h2.detune, at, cents, control.rampSeconds); scheduleParam(h3.detune, at, cents, control.rampSeconds); const bentHz = hz * 2 ** (control.pitchBend / 12); scheduleParam(delay.delayTime, at, Math.min(0.08, Math.max(1 / 18_000, 1 / bentHz)), control.rampSeconds) }
  }

  const endState = physicalPerformanceStateAt(track, controls, event.timeSeconds + duration), endPressure = pressureFor(event.velocity, endState.pressure), finalPeak = wetGainFor(source, endPressure, endState.embouchure, tuning.wetScale)
  output.gain.setValueAtTime(Math.max(0.001, finalPeak * 0.9), Math.max(start + attack, start + duration - 0.012)); output.gain.exponentialRampToValueAtTime(0.0001, stop)
  fundamental.start(start); fundamental.stop(stop); h2.start(start); h2.stop(stop); h3.start(start); h3.stop(stop); breath.start(start); breath.stop(stop); lfo.start(start); lfo.stop(stop)
  return { endSeconds: event.timeSeconds + duration + release }
}
