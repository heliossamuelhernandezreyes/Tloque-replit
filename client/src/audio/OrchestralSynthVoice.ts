import type { LinearScoreControlV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { ORCHESTRAL_SYNTH_MAX_SOURCES, orchestralIdentityUnit, orchestralSpectrum, orchestralTimbreFor } from "@shared/orchestral-synthesis"
import { articulationDurationFactor, articulationVelocityFactor, midiNoteToFrequency, scoreVelocityGain } from "./ScoreAudioMath"
import { deterministicNoiseOffset, sharedDeterministicNoiseBuffer } from "./DeterministicAudioNoise"
import { orchestralExpressionCurve, orchestralNoteExpression } from "./OrchestralExpression"
import { nativeControlValueAt } from "./NativeRecipeIndex"
import { orchestralContinuousDynamics, orchestralDynamicCutoffCurve } from "./OrchestralDynamics"

export interface OrchestralSynthEvent {
  timeSeconds: number
  durationSeconds: number
  notes: readonly number[]
  velocity: number
  articulation?: string
  timbre?: string
  durationIsPerformed?: boolean
  legatoFromPrevious?: boolean
  transitionFromMidi?: number
}

const waves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>()
const reservations = new WeakMap<BaseAudioContext, { start: number; end: number; cost: number }[]>()

/** Bounded source admission in audio time, including release tails and future notes.
 * Offline plans are chronological. Realtime recovery can arrive after a later
 * look-ahead task: retain all not-yet-ended reservations against the live clock. */
function reserve(context: BaseAudioContext, start: number, end: number, cost: number) {
  const offline = typeof (context as OfflineAudioContext).startRendering === "function"
  const discardBefore = offline ? start : context.currentTime
  const previous = (reservations.get(context) ?? []).filter(item => item.end > discardBefore)
  const points = previous.filter(item => item.end > start && item.start < end)
    .flatMap(item => [{ time: Math.max(start, item.start), delta: item.cost }, { time: item.end, delta: -item.cost }])
    .filter(point => point.time < end).sort((a, b) => a.time - b.time || a.delta - b.delta)
  let active = cost
  for (const point of points) { active += point.delta; if (active > ORCHESTRAL_SYNTH_MAX_SOURCES) return false }
  previous.push({ start, end, cost }); reservations.set(context, previous)
  return true
}

function waveFor(context: BaseAudioContext, instrument: string, midi: number, brightness: number) {
  let cache = waves.get(context)
  if (!cache) { cache = new Map(); waves.set(context, cache) }
  const colour = Math.round(brightness * 15) / 15
  const key = `${instrument}:${midi}:${colour}`
  let wave = cache.get(key)
  if (!wave) {
    const imaginary = orchestralSpectrum(orchestralTimbreFor(instrument, midi), midiNoteToFrequency(midi), colour, context.sampleRate)
    wave = context.createPeriodicWave(new Float32Array(imaginary.length), imaginary, { disableNormalization: true })
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, wave)
  }
  return wave
}

/** Shared Web Audio instrument voice for explicit orchestral synthesis and native
 * recovery. Family spectra, modal decays, delayed vibrato, bow/breath transients,
 * section decorrelation and the native concert stage are identical in WAV/live. */
export function scheduleOrchestralSynthVoice(context: BaseAudioContext, destination: AudioNode, startAt: number, event: OrchestralSynthEvent, track: LinearScoreTrackV2, level = 1, controls: readonly LinearScoreControlV2[] = []) {
  const articulation = event.articulation ?? "normal"
  const duration = Math.max(0.025, event.durationSeconds * (event.durationIsPerformed ? 1 : articulationDurationFactor(articulation)))
  const begins = Math.max(context.currentTime, startAt + event.timeSeconds)
  let scheduled = 0
  for (const midi of event.notes) {
    const profile = orchestralTimbreFor(track.instrument, midi)
    const plucked = profile.decay > 0 || articulation === "pizzicato"
    const connectedLegato = !plucked && event.legatoFromPrevious === true && event.transitionFromMidi !== undefined
    const attack = Math.min(duration * 0.25, Math.max(0.004, connectedLegato ? Math.min(0.014, profile.attack * 0.18) : articulation === "legato" ? profile.attack * 0.45 : Math.min(track.attack, profile.attack)))
    const release = Math.min(2.5, Math.max(profile.release, Math.min(track.release, plucked ? 1.8 : 0.65)))
    const end = begins + duration + release
    const identity = `${track.id}:${track.instrument}:${event.timeSeconds}:${midi}`
    const expression = orchestralNoteExpression(track.instrument, articulation, duration, 1, false, identity)
    const dynamics = orchestralContinuousDynamics(track, controls, event.timeSeconds, duration, event.velocity, articulation)
    const frequency = track.instrument === "percussion.orchestral-kit" ? (midi === 36 ? 58 : midi < 42 ? 180 : 520) : midiNoteToFrequency(midi) * (articulation === "harmonic" ? 2 : 1)
    const ratios = profile.modalRatios?.filter(ratio => frequency * ratio < context.sampleRate * 0.44)
    const sourceCount = ratios?.length ?? profile.ensemble
    if (!reserve(context, begins, end + 0.025, sourceCount + (profile.noise > 0 ? 1 : 0))) continue
    const nodes: AudioNode[] = []
    const amplitude = Math.max(0, Math.min(0.3, scoreVelocityGain(event.velocity) * articulationVelocityFactor(articulation) * 0.3)) * Math.max(0, Math.min(1, level)) / Math.sqrt(Math.max(1, event.notes.length / 3))
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0, begins)
    envelope.gain.linearRampToValueAtTime(amplitude, begins + attack)
    const decay = plucked ? (profile.decay || 3.5) : 0
    const sustain = decay ? Math.max(0.001, amplitude * Math.exp(-duration * decay)) : amplitude * 0.88
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.00001, sustain), begins + duration)
    envelope.gain.exponentialRampToValueAtTime(0.00001, end)
    const phrasing = context.createGain()
    if (expression.swell || articulation === "tremolo") {
      const curve = orchestralExpressionCurve(expression, duration, "gain")
      if (articulation === "tremolo") for (let i = 0; i < curve.length; i++) curve[i] *= 0.65 + 0.35 * Math.cos(2 * Math.PI * 7 * duration * i / (curve.length - 1))
      phrasing.gain.setValueCurveAtTime(curve, begins, duration)
    }
    const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.Q.value = 0.35
    if (dynamics.sustained) tone.frequency.setValueCurveAtTime(orchestralDynamicCutoffCurve(dynamics, context.sampleRate, "synth"), begins, duration)
    else {
      const baseHz = Math.min(context.sampleRate * 0.44, 1700 + track.brightness * 11500)
      tone.frequency.setValueAtTime(baseHz * (0.5 + event.velocity * 0.5), begins)
      tone.frequency.exponentialRampToValueAtTime(Math.max(250, baseHz * (plucked ? 0.35 : 0.82)), begins + duration)
    }
    envelope.connect(phrasing); phrasing.connect(tone); tone.connect(destination)
    nodes.push(envelope, phrasing, tone)
    let remaining = sourceCount + (profile.noise > 0 ? 1 : 0)
    const cleanup = (source: AudioScheduledSourceNode) => source.addEventListener("ended", () => {
      source.disconnect()
      if (--remaining === 0) for (const node of nodes) node.disconnect()
    }, { once: true })
    for (let member = 0; member < sourceCount; member++) {
      const oscillator = context.createOscillator()
      const memberGain = context.createGain()
      if (ratios) {
        oscillator.type = "sine"
        oscillator.frequency.value = frequency * ratios[member]
        const curve = orchestralExpressionCurve({ ...expression, vibratoCents: 0 }, duration, "detune")
        for (let i = 0; i < curve.length; i++) curve[i] = nativeControlValueAt(controls, "pitchBend", event.timeSeconds + duration * i / (curve.length - 1), 0) * 100
        oscillator.detune.setValueCurveAtTime(curve, begins, duration)
        const weight = 1 / (member + 1) ** 1.65
        memberGain.gain.setValueAtTime(weight * 0.62, begins)
        memberGain.gain.exponentialRampToValueAtTime(0.00001, begins + Math.max(0.03, (duration + release) / (1 + member * 0.65)))
      } else {
        const waveBrightness = Math.max(track.brightness, ...dynamics.brightness)
        oscillator.setPeriodicWave(waveFor(context, track.instrument, midi, waveBrightness))
        if (connectedLegato) {
          const from = midiNoteToFrequency(event.transitionFromMidi!) * (articulation === "harmonic" ? 2 : 1)
          const transitionSeconds = Math.min(duration * 0.18, Math.max(0.018, 0.026 + Math.abs(midi - event.transitionFromMidi!) * 0.0018))
          oscillator.frequency.setValueAtTime(from, begins)
          oscillator.frequency.exponentialRampToValueAtTime(frequency, begins + transitionSeconds)
        } else oscillator.frequency.value = frequency
        const detune = sourceCount > 1 ? (member - (sourceCount - 1) / 2) * 4.5 : 0
        const curve = orchestralExpressionCurve({ ...expression, identity: `${identity}:${member}`, vibratoHz: expression.vibratoHz + member * 0.13 }, duration, "detune")
        for (let i = 0; i < curve.length; i++) {
          const time = event.timeSeconds + duration * i / (curve.length - 1)
          const vibrato = (event.timbre ?? track.timbre) === "non-vibrato" ? 0 : nativeControlValueAt(controls, "vibrato", time, track.vibrato)
          curve[i] = curve[i] * vibrato + detune + nativeControlValueAt(controls, "pitchBend", time, 0) * 100
        }
        oscillator.detune.setValueCurveAtTime(curve, begins, duration)
        // Power normalization keeps a decorrelated section from becoming much
        // quieter than the solo while retaining bounded oscillator amplitudes.
        memberGain.gain.value = 1 / Math.sqrt(sourceCount)
      }
      oscillator.connect(memberGain)
      if (sourceCount > 1 && !ratios && typeof context.createStereoPanner === "function") {
        const pan = context.createStereoPanner(); pan.pan.value = (member - (sourceCount - 1) / 2) * 0.16
        memberGain.connect(pan); pan.connect(envelope); nodes.push(pan)
      } else memberGain.connect(envelope)
      nodes.push(memberGain); cleanup(oscillator)
      oscillator.start(begins + (ratios ? 0 : member * 0.003)); oscillator.stop(end)
    }
    if (profile.noise > 0) {
      const noise = context.createBufferSource()
      const buffer = sharedDeterministicNoiseBuffer(context, "orchestral-excitation", 2, 0.35)
      noise.buffer = buffer; noise.loop = true
      const filter = context.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = Math.min(context.sampleRate * 0.4, profile.formantHz * 1.4); filter.Q.value = 0.65
      const noiseGain = context.createGain()
      const excitation = connectedLegato ? 0.28 : 1
      noiseGain.gain.setValueAtTime(profile.noise * excitation * (0.8 + 0.2 * orchestralIdentityUnit(identity)), begins)
      noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.00001, profile.noise * (plucked ? 0.005 : 0.18)), begins + Math.min(duration, 0.22))
      noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(envelope)
      nodes.push(filter, noiseGain); cleanup(noise)
      noise.start(begins, deterministicNoiseOffset(identity, buffer.duration)); noise.stop(end)
    }
    scheduled++
  }
  return scheduled
}
