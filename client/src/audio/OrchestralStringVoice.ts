import type { LinearScoreControlV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { orchestralIdentityUnit } from "@shared/orchestral-synthesis"
import { physicalPerformanceStateAt } from "@shared/physical-performance-control"
import { sharedDeterministicNoiseBuffer, deterministicNoiseOffset } from "./DeterministicAudioNoise"
import { orchestralContinuousDynamics, orchestralDynamicCutoffCurve } from "./OrchestralDynamics"
import { orchestralExpressionCurve, orchestralNoteExpression } from "./OrchestralExpression"
import { nativeControlValueAt } from "./NativeRecipeIndex"
import { articulationVelocityFactor, midiNoteToFrequency, scoreVelocityGain } from "./ScoreAudioMath"

export const ORCHESTRAL_STRING_DSP_VERSION = "tloque-bowed-string-dsp-v3" as const
export const ORCHESTRAL_STRING_WORKLET_PROCESSOR = "tloque-bowed-string-v3" as const
export const ORCHESTRAL_STRING_WORKLET_URL = `/audio-worklets/tloque-bowed-string-v3.js?v=${ORCHESTRAL_STRING_DSP_VERSION}`

export interface OrchestralPhysicalStringEvent {
  timeSeconds: number
  durationSeconds: number
  notes: readonly number[]
  velocity: number
  articulation?: string
  timbre?: string
  legatoFromPrevious?: boolean
  transitionFromMidi?: number
  /** Per-event renderer gain. The bank-free synth leaves this at one; the
   * sample-dominant hybrid uses its versioned wet ceiling. */
  physicalLevel?: number
}

export interface OrchestralStringProfile {
  instrument: string
  bowNoise: number
  bowPressure: number
  feedback: number
  stiffness: number
  bridgeHz: number
  bodyModesHz: readonly number[]
  bodyGains: readonly number[]
  releaseSeconds: number
}

export interface OrchestralStringQuality {
  oversample: 1 | 2 | 4
  sectionMembers: number
  controlRateHz: number
}

export interface OrchestralStringRenderTuning {
  feedbackScale?: number
  dampingScale?: number
  textureScale?: number
  bodyScale?: number
  releaseScale?: number
}

type NormalizedStringTuning = Required<OrchestralStringRenderTuning>

type WorkletContext = BaseAudioContext & { audioWorklet?: { addModule(url: string): Promise<void> } }
type WorkletConstructor = new (context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) => AudioWorkletNode

const prepared = new WeakMap<BaseAudioContext, Promise<boolean>>()
const ready = new WeakSet<BaseAudioContext>()

function normalizedStringTuning(tuning: OrchestralStringRenderTuning | undefined): NormalizedStringTuning {
  const bounded = (value: number | undefined, min: number, max: number) => Math.max(min, Math.min(max, value ?? 1))
  return {
    feedbackScale: bounded(tuning?.feedbackScale, 0.9, 1.06),
    dampingScale: bounded(tuning?.dampingScale, 0.82, 1.18),
    textureScale: bounded(tuning?.textureScale, 0.78, 1.22),
    bodyScale: bounded(tuning?.bodyScale, 0.82, 1.18),
    releaseScale: bounded(tuning?.releaseScale, 0.8, 1.2),
  }
}

function workletConstructor(): WorkletConstructor | null {
  return (globalThis as typeof globalThis & { AudioWorkletNode?: WorkletConstructor }).AudioWorkletNode ?? null
}

/** Load once per context. Unsupported browsers and the Node offline harness use
 * the equivalent deterministic Web Audio waveguide below. */
export function prepareOrchestralStringDsp(context: BaseAudioContext): Promise<boolean> {
  const existing = prepared.get(context)
  if (existing) return existing
  const worklet = (context as WorkletContext).audioWorklet
  const promise = !worklet || !workletConstructor()
    ? Promise.resolve(false)
    : worklet.addModule(ORCHESTRAL_STRING_WORKLET_URL).then(() => { ready.add(context); return true }).catch(() => false)
  prepared.set(context, promise)
  return promise
}

export function orchestralStringWorkletReady(context: BaseAudioContext) { return ready.has(context) }

export function isBowedOrchestralString(instrument: string) {
  return instrument.startsWith("strings.") && instrument !== "strings.harp"
}

export function orchestralStringQuality(sampleRate: number): OrchestralStringQuality {
  if (sampleRate >= 88_200) return { oversample: 4, sectionMembers: 3, controlRateHz: 64 }
  if (sampleRate >= 44_100) return { oversample: 2, sectionMembers: 3, controlRateHz: 48 }
  return { oversample: 1, sectionMembers: 2, controlRateHz: 32 }
}

export function orchestralStringProfileFor(instrument: string): OrchestralStringProfile {
  if (instrument === "strings.contrabass") return { instrument, bowNoise: 0.11, bowPressure: 0.76, feedback: 0.986, stiffness: 0.24, bridgeHz: 2_100, bodyModesHz: [72, 108, 176, 286, 430], bodyGains: [0.22, 0.2, 0.19, 0.14, 0.08], releaseSeconds: 0.48 }
  if (instrument === "strings.cello") return { instrument, bowNoise: 0.1, bowPressure: 0.72, feedback: 0.983, stiffness: 0.2, bridgeHz: 3_300, bodyModesHz: [118, 238, 410, 690, 1_080], bodyGains: [0.2, 0.2, 0.17, 0.12, 0.08], releaseSeconds: 0.42 }
  if (instrument === "strings.viola") return { instrument, bowNoise: 0.092, bowPressure: 0.69, feedback: 0.98, stiffness: 0.17, bridgeHz: 4_500, bodyModesHz: [196, 392, 710, 1_180, 2_350], bodyGains: [0.18, 0.19, 0.16, 0.12, 0.07], releaseSeconds: 0.36 }
  return { instrument, bowNoise: 0.086, bowPressure: 0.66, feedback: 0.978, stiffness: 0.14, bridgeHz: 5_800, bodyModesHz: [278, 552, 980, 1_720, 3_100], bodyGains: [0.16, 0.18, 0.15, 0.11, 0.07], releaseSeconds: 0.32 }
}

/** Odd, bounded bow-friction curve. It is used only inside the feedback loop and
 * is oversampled by the browser, preventing the raw waveshaper from becoming an
 * unbounded or strongly aliased sound source. */
export function orchestralBowFrictionCurve(points = 4096) {
  const size = Math.max(32, Math.min(16_384, Math.floor(points)))
  const curve = new Float32Array(size)
  for (let index = 0; index < size; index += 1) {
    const x = index / (size - 1) * 2 - 1
    curve[index] = Math.tanh(x * 2.8) * (0.92 - 0.12 * x * x)
  }
  return curve
}

function stableSeed(identity: string) {
  return Math.max(1, Math.floor(orchestralIdentityUnit(identity) * 0x7ffffffe))
}

function bandlimitedBowWave(context: BaseAudioContext, highestFrequency: number, brightness: number) {
  const limit = Math.max(1, Math.min(48, Math.floor(context.sampleRate * 0.44 / Math.max(20, highestFrequency))))
  const real = new Float32Array(limit + 1), imaginary = new Float32Array(limit + 1)
  let energy = 0
  for (let harmonic = 1; harmonic <= limit; harmonic += 1) {
    const amount = 1 / harmonic ** (1.05 + (1 - brightness) * 0.65)
    imaginary[harmonic] = amount
    energy += amount
  }
  if (energy > 0) for (let harmonic = 1; harmonic <= limit; harmonic += 1) imaginary[harmonic] /= energy
  return context.createPeriodicWave(real, imaginary, { disableNormalization: true })
}

function connectBody(context: BaseAudioContext, source: AudioNode, destination: AudioNode, profile: OrchestralStringProfile, tuning: NormalizedStringTuning) {
  const body = context.createGain(); body.gain.value = 0.78 * tuning.bodyScale
  const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.frequency.value = 24; highpass.Q.value = 0.62
  source.connect(highpass)
  const nodes: AudioNode[] = [body, highpass]
  const presence = context.createBiquadFilter(); presence.type = "highshelf"; presence.frequency.value = Math.min(context.sampleRate * 0.22, 3_200); presence.gain.value = 0
  const bridge = context.createBiquadFilter(); bridge.type = "lowpass"; bridge.frequency.value = Math.min(context.sampleRate * 0.42, profile.bridgeHz); bridge.Q.value = 0.42
  highpass.connect(presence); presence.connect(bridge); bridge.connect(body); nodes.push(presence, bridge)
  profile.bodyModesHz.forEach((frequency, index) => {
    const mode = context.createBiquadFilter(); mode.type = "bandpass"; mode.frequency.value = frequency; mode.Q.value = 3.1 + index * 0.55
    const gain = context.createGain(); gain.gain.value = profile.bodyGains[index] ?? 0.05
    highpass.connect(mode); mode.connect(gain); gain.connect(body); nodes.push(mode, gain)
  })
  body.connect(destination)
  return { nodes, body, bridge, presence }
}

function schedulePitch(param: AudioParam, events: readonly OrchestralPhysicalStringEvent[], startAt: number, memberCents: number, asDelay = false, sampleRate = 48_000) {
  const value = (midi: number) => {
    const hz = midiNoteToFrequency(midi) * 2 ** (memberCents / 1200)
    return asDelay ? Math.max(1 / sampleRate, 1 / hz - 2 / sampleRate) : hz
  }
  const firstMidi = events[0].notes[0]
  param.setValueAtTime(value(firstMidi), startAt + events[0].timeSeconds)
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index], midi = event.notes[0], at = startAt + event.timeSeconds
    const previousMidi = events[index - 1].notes[0]
    if (event.legatoFromPrevious) {
      const transition = Math.min(event.durationSeconds * 0.2, Math.max(0.018, 0.026 + Math.abs(midi - previousMidi) * 0.0018))
      param.setValueAtTime(value(previousMidi), at)
      param.exponentialRampToValueAtTime(value(midi), at + transition)
    } else param.setValueAtTime(value(midi), at)
  }
}

function scheduleMemberEnvelope(param: AudioParam, events: readonly OrchestralPhysicalStringEvent[], track: LinearScoreTrackV2, startAt: number, release: number, level: number) {
  const begins = startAt + events[0].timeSeconds
  const last = events.at(-1)!
  const end = startAt + last.timeSeconds + last.durationSeconds
  const amplitudeFor = (event: OrchestralPhysicalStringEvent) => Math.max(0.0001, Math.min(0.65,
    scoreVelocityGain(event.velocity) * articulationVelocityFactor(event.articulation ?? "normal")
    * 1.35 * level * Math.max(0, Math.min(1, event.physicalLevel ?? 1))))
  param.setValueAtTime(0.0001, begins)
  const first = events[0]
  const firstAttack = Math.min(first.durationSeconds * 0.25, Math.max(0.012, first.legatoFromPrevious ? 0.018 : Math.min(0.085, track.attack)))
  param.exponentialRampToValueAtTime(amplitudeFor(first), begins + firstAttack)
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index], at = startAt + event.timeSeconds
    param.exponentialRampToValueAtTime(amplitudeFor(event), at + Math.min(0.025, event.durationSeconds * 0.15))
  }
  param.setValueAtTime(amplitudeFor(last), end)
  param.exponentialRampToValueAtTime(0.0001, end + release)
}

function eventControlSpan(events: readonly OrchestralPhysicalStringEvent[], index: number) {
  const event = events[index], next = events[index + 1]
  return Math.max(0.01, Math.min(event.durationSeconds, next ? next.timeSeconds - event.timeSeconds : event.durationSeconds))
}

function physicalCurve(
  event: OrchestralPhysicalStringEvent,
  duration: number,
  points: number,
  track: LinearScoreTrackV2,
  controls: readonly LinearScoreControlV2[],
  key: "pressure" | "bowPosition" | "sympatheticCoupling",
) {
  return Float32Array.from({ length: points }, (_, index) => physicalPerformanceStateAt(
    track,
    controls,
    event.timeSeconds + duration * index / Math.max(1, points - 1),
  )[key])
}

function bowGestureScale(articulation: string | undefined, index: number, points: number, duration: number) {
  const progress = index / Math.max(1, points - 1)
  if (articulation === "tremolo") return 0.58 + 0.42 * Math.abs(Math.sin(progress * duration * Math.PI * 15.2))
  if (articulation === "spiccato") return 1 - progress * 0.38
  if (articulation === "accent") return 0.82 + Math.exp(-progress * 12) * 0.18
  return 1
}

function scheduleBodyPerformance(
  body: GainNode,
  bridge: BiquadFilterNode,
  presence: BiquadFilterNode,
  events: readonly OrchestralPhysicalStringEvent[],
  track: LinearScoreTrackV2,
  controls: readonly LinearScoreControlV2[],
  startAt: number,
  profile: OrchestralStringProfile,
  sampleRate: number,
  tuning: NormalizedStringTuning,
) {
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex], span = eventControlSpan(events, eventIndex), at = startAt + event.timeSeconds
    const curve = physicalCurve(event, span, Math.max(2, Math.ceil(span * 24)), track, controls, "sympatheticCoupling")
    body.gain.setValueCurveAtTime(Float32Array.from(curve, value => (0.55 + value * 0.45) * tuning.bodyScale), at, span)
    const dynamics = orchestralContinuousDynamics(track, controls, event.timeSeconds, span, event.velocity, event.articulation)
    bridge.frequency.setValueCurveAtTime(Float32Array.from(dynamics.brightness, value => Math.min(
      sampleRate * 0.42,
      profile.bridgeHz * (0.48 + value * 1.34) * tuning.dampingScale,
    )), at, span)
    presence.gain.setValueCurveAtTime(Float32Array.from(dynamics.brightness, value => -4 + value * 14), at, span)
  }
}

function eventDetuneCurve(event: OrchestralPhysicalStringEvent, duration: number, track: LinearScoreTrackV2, controls: readonly LinearScoreControlV2[], identity: string) {
  const articulation = event.articulation ?? "normal"
  const expression = orchestralNoteExpression(track.instrument, articulation, duration, 1, false, identity)
  const curve = orchestralExpressionCurve(expression, duration, "detune")
  for (let index = 0; index < curve.length; index += 1) {
    const time = event.timeSeconds + duration * index / (curve.length - 1)
    const vibrato = (event.timbre ?? track.timbre) === "non-vibrato" ? 0 : nativeControlValueAt(controls, "vibrato", time, track.vibrato)
    curve[index] = curve[index] * vibrato + nativeControlValueAt(controls, "pitchBend", time, 0) * 100
  }
  return curve
}

function scheduleWorkletMember(
  context: BaseAudioContext,
  destination: AudioNode,
  startAt: number,
  events: readonly OrchestralPhysicalStringEvent[],
  track: LinearScoreTrackV2,
  level: number,
  controls: readonly LinearScoreControlV2[],
  profile: OrchestralStringProfile,
  quality: OrchestralStringQuality,
  member: number,
  members: number,
  tuning: NormalizedStringTuning,
) {
  const WorkletNode = workletConstructor()
  if (!WorkletNode || !ready.has(context)) return false
  const begins = startAt + events[0].timeSeconds
  const last = events.at(-1)!, noteEnd = startAt + last.timeSeconds + last.durationSeconds
  const release = profile.releaseSeconds * tuning.releaseScale
  const identity = `${track.id}:${profile.instrument}:${events[0].timeSeconds}:${events.map(event => event.notes[0]).join(",")}:${member}`
  const node = new WorkletNode(context, ORCHESTRAL_STRING_WORKLET_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      version: ORCHESTRAL_STRING_DSP_VERSION,
      startFrame: Math.round(begins * context.sampleRate),
      endFrame: Math.round(noteEnd * context.sampleRate),
      releaseFrames: Math.round(release * context.sampleRate),
      oversample: quality.oversample,
      seed: stableSeed(identity),
      feedback: profile.feedback * tuning.feedbackScale,
      stiffness: profile.stiffness,
      textureScale: tuning.textureScale,
      member,
    },
  })
  const frequency = node.parameters.get("frequency"), detune = node.parameters.get("detune")
  const pressure = node.parameters.get("bowPressure"), bowPosition = node.parameters.get("bowPosition"), brightness = node.parameters.get("brightness")
  const gate = node.parameters.get("gate")
  if (!frequency || !detune || !pressure || !bowPosition || !brightness || !gate) { node.disconnect(); return false }
  const memberCents = members > 1 ? (member - (members - 1) / 2) * 3.8 : 0
  schedulePitch(frequency, events, startAt, memberCents)
  gate.setValueAtTime(0, Math.max(0, begins - 0.001)); gate.setValueAtTime(1, begins); gate.setValueAtTime(0, noteEnd)
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex], span = eventControlSpan(events, eventIndex)
    const at = startAt + event.timeSeconds
    const dynamics = orchestralContinuousDynamics(track, controls, event.timeSeconds, span, event.velocity, event.articulation)
    const physicalPressure = physicalCurve(event, span, dynamics.effort.length, track, controls, "pressure")
    const position = physicalCurve(event, span, dynamics.effort.length, track, controls, "bowPosition")
    pressure.setValueCurveAtTime(Float32Array.from(dynamics.effort, (value, index) => Math.min(1,
      profile.bowPressure * (0.35 + value * 0.45 + physicalPressure[index] * 0.35)
      * bowGestureScale(event.articulation, index, dynamics.effort.length, span),
    )), at, span)
    bowPosition.setValueCurveAtTime(position, at, span)
    brightness.setValueCurveAtTime(dynamics.brightness, at, span)
    detune.setValueCurveAtTime(eventDetuneCurve(event, span, track, controls, identity), at, span)
  }
  const amplitude = context.createGain(); scheduleMemberEnvelope(amplitude.gain, events, track, startAt, release, level / Math.sqrt(members))
  const bodyPath = connectBody(context, node, amplitude, profile, tuning)
  scheduleBodyPerformance(bodyPath.body, bodyPath.bridge, bodyPath.presence, events, track, controls, startAt, profile, context.sampleRate, tuning)
  if (members > 1 && typeof context.createStereoPanner === "function") {
    const pan = context.createStereoPanner(); pan.pan.value = (member - (members - 1) / 2) * 0.15
    amplitude.connect(pan); pan.connect(destination); bodyPath.nodes.push(pan)
  } else amplitude.connect(destination)
  node.port.onmessage = message => {
    if (message.data !== "ended") return
    node.disconnect(); amplitude.disconnect(); for (const item of bodyPath.nodes) item.disconnect()
  }
  node.onprocessorerror = () => { node.disconnect(); amplitude.disconnect(); for (const item of bodyPath.nodes) item.disconnect() }
  return true
}

function scheduleWaveguideMember(
  context: BaseAudioContext,
  destination: AudioNode,
  startAt: number,
  events: readonly OrchestralPhysicalStringEvent[],
  track: LinearScoreTrackV2,
  level: number,
  controls: readonly LinearScoreControlV2[],
  profile: OrchestralStringProfile,
  quality: OrchestralStringQuality,
  member: number,
  members: number,
  tuning: NormalizedStringTuning,
) {
  const begins = Math.max(context.currentTime, startAt + events[0].timeSeconds)
  const last = events.at(-1)!, noteEnd = startAt + last.timeSeconds + last.durationSeconds
  const release = profile.releaseSeconds * tuning.releaseScale
  const stop = noteEnd + release + 0.05
  const identity = `${track.id}:${profile.instrument}:${events[0].timeSeconds}:${events.map(event => event.notes[0]).join(",")}:${member}`
  const memberCents = members > 1 ? (member - (members - 1) / 2) * 3.8 : 0
  const highest = Math.max(...events.map(event => midiNoteToFrequency(event.notes[0]) * 2 ** (memberCents / 1200)))
  const exciter = context.createOscillator(); exciter.setPeriodicWave(bandlimitedBowWave(context, highest, track.brightness))
  schedulePitch(exciter.frequency, events, startAt, memberCents)
  const bowGain = context.createGain(); bowGain.gain.value = 0.085
  const noise = context.createBufferSource(); const noiseBuffer = sharedDeterministicNoiseBuffer(context, "orchestral-string-v3", 8, 0.69)
  noise.buffer = noiseBuffer; noise.loop = true
  const noiseBand = context.createBiquadFilter(); noiseBand.type = "bandpass"; noiseBand.frequency.value = Math.min(context.sampleRate * 0.4, profile.bridgeHz * 0.78); noiseBand.Q.value = 0.62
  const noiseGain = context.createGain(); noiseGain.gain.value = profile.bowNoise * tuning.textureScale
  const input = context.createGain(); input.gain.value = 0.72
  exciter.connect(bowGain); bowGain.connect(input); noise.connect(noiseBand); noiseBand.connect(noiseGain); noiseGain.connect(input)
  const friction = context.createWaveShaper(); friction.curve = orchestralBowFrictionCurve(); friction.oversample = quality.oversample === 4 ? "4x" : quality.oversample === 2 ? "2x" : "none"
  const waveguide = context.createDelay(0.12), damping = context.createBiquadFilter(), primaryGain = context.createGain()
  const returnWave = context.createDelay(0.24), returnDamping = context.createBiquadFilter(), returnGain = context.createGain(), stringBus = context.createGain()
  // Web Audio feedback cycles may acquire a render-quantum delay in fallback
  // implementations. Two feed-forward travelling-wave paths preserve the
  // authored oscillator pitch; the AudioWorklet backend owns sample-accurate
  // nonlinear feedback.
  damping.type = "lowpass"; damping.Q.value = 0.3; primaryGain.gain.value = 0.72 * tuning.feedbackScale
  returnDamping.type = "lowpass"; returnDamping.frequency.value = Math.min(context.sampleRate * 0.38, profile.bridgeHz * 0.72 * tuning.dampingScale); returnDamping.Q.value = 0.25; returnGain.gain.value = 0.28 * tuning.feedbackScale
  stringBus.gain.value = 0.9
  input.connect(friction); friction.connect(waveguide); friction.connect(returnWave)
  waveguide.connect(damping); damping.connect(primaryGain); primaryGain.connect(stringBus)
  returnWave.connect(returnDamping); returnDamping.connect(returnGain); returnGain.connect(stringBus)
  schedulePitch(waveguide.delayTime, events, startAt, memberCents, true, context.sampleRate)
  const returnEvents = events.map(event => ({ ...event, notes: [event.notes[0] - 12] }))
  schedulePitch(returnWave.delayTime, returnEvents, startAt, memberCents, true, context.sampleRate)
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex], span = eventControlSpan(events, eventIndex)
    const at = startAt + event.timeSeconds
    const dynamics = orchestralContinuousDynamics(track, controls, event.timeSeconds, span, event.velocity, event.articulation)
    const pressure = physicalCurve(event, span, dynamics.effort.length, track, controls, "pressure")
    const position = physicalCurve(event, span, dynamics.effort.length, track, controls, "bowPosition")
    const cutoff = Float32Array.from(orchestralDynamicCutoffCurve(dynamics, context.sampleRate, "synth"), value => Math.min(context.sampleRate * 0.44, value * tuning.dampingScale))
    damping.frequency.setValueCurveAtTime(cutoff, at, span)
    returnDamping.frequency.setValueCurveAtTime(Float32Array.from(cutoff, value => Math.max(400, value * 0.72)), at, span)
    noiseBand.frequency.setValueCurveAtTime(Float32Array.from(position, value => Math.min(context.sampleRate * 0.4, profile.bridgeHz * (0.5 + value * 0.72))), at, span)
    const effort = Float32Array.from(dynamics.effort, (value, index) => (0.025 + value * 0.065 + pressure[index] * 0.04)
      * bowGestureScale(event.articulation, index, dynamics.effort.length, span))
    bowGain.gain.setValueCurveAtTime(effort, at, span)
    noiseGain.gain.setValueCurveAtTime(Float32Array.from(effort, value => value * profile.bowNoise * 5 * tuning.textureScale), at, span)
    exciter.detune.setValueCurveAtTime(eventDetuneCurve(event, span, track, controls, identity), at, span)
  }
  const amplitude = context.createGain(); scheduleMemberEnvelope(amplitude.gain, events, track, startAt, release, level / Math.sqrt(members))
  const bodyPath = connectBody(context, stringBus, amplitude, profile, tuning)
  scheduleBodyPerformance(bodyPath.body, bodyPath.bridge, bodyPath.presence, events, track, controls, startAt, profile, context.sampleRate, tuning)
  const nodes: AudioNode[] = [bowGain, noiseBand, noiseGain, input, friction, waveguide, damping, primaryGain, returnWave, returnDamping, returnGain, stringBus, amplitude, ...bodyPath.nodes]
  if (members > 1 && typeof context.createStereoPanner === "function") {
    const pan = context.createStereoPanner(); pan.pan.value = (member - (members - 1) / 2) * 0.15
    amplitude.connect(pan); pan.connect(destination); nodes.push(pan)
  } else amplitude.connect(destination)
  // Offline contexts can render much faster than their control-thread `ended`
  // callbacks are dispatched. Mutating the graph from those callbacks makes the
  // exact tail depend on wall-clock load, so keep the already-silent graph intact
  // until offline rendering completes. Realtime contexts still release every node.
  const isOffline = typeof (context as BaseAudioContext & { startRendering?: unknown }).startRendering === "function"
  if (!isOffline) {
    let remaining = 2
    const cleanup = (source: AudioScheduledSourceNode) => source.addEventListener("ended", () => {
      source.disconnect()
      if (--remaining === 0) for (const node of nodes) node.disconnect()
    }, { once: true })
    cleanup(exciter); cleanup(noise)
  }
  exciter.start(begins); exciter.stop(stop)
  noise.start(begins, deterministicNoiseOffset(identity, noiseBuffer.duration)); noise.stop(stop)
}

/** Schedule one continuous physical state for a monophonic bowed phrase. The
 * return value is the number of authored note events admitted, not DSP nodes. */
export function scheduleOrchestralStringPhrase(
  context: BaseAudioContext,
  destination: AudioNode,
  startAt: number,
  events: readonly OrchestralPhysicalStringEvent[],
  track: LinearScoreTrackV2,
  level: number,
  controls: readonly LinearScoreControlV2[],
  reserve: (start: number, end: number, cost: number) => boolean,
  renderTuning?: OrchestralStringRenderTuning,
) {
  if (!events.length || !isBowedOrchestralString(track.instrument) || events.some(event => event.notes.length !== 1)) return 0
  const profile = orchestralStringProfileFor(track.instrument), quality = orchestralStringQuality(context.sampleRate)
  const tuning = normalizedStringTuning(renderTuning)
  const members = track.instrument.endsWith("-section") ? quality.sectionMembers : 1
  const begins = Math.max(context.currentTime, startAt + events[0].timeSeconds)
  const last = events.at(-1)!, end = startAt + last.timeSeconds + last.durationSeconds + profile.releaseSeconds * tuning.releaseScale
  if (!reserve(begins, end + 0.05, members + 1)) return 0
  for (let member = 0; member < members; member += 1) {
    if (!scheduleWorkletMember(context, destination, startAt, events, track, level, controls, profile, quality, member, members, tuning)) {
      scheduleWaveguideMember(context, destination, startAt, events, track, level, controls, profile, quality, member, members, tuning)
    }
  }
  return events.length
}
