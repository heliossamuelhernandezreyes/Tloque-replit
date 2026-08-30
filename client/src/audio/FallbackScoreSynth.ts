import type { LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import {
  articulationDurationFactor,
  midiNoteToFrequency,
  scoreTrackEnvelope,
  scoreVelocityGain,
} from "./ScoreAudioMath"

export interface FallbackScoreEvent {
  timeSeconds: number
  durationSeconds: number
  notes: readonly number[]
  velocity: number
  articulation?: string
}

/**
 * Bounded emergency voice used only for tracks whose native source cannot be
 * fetched or decoded. It shares the native track graph, stage and master.
 */
export function scheduleFallbackSynthVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  startAt: number,
  event: FallbackScoreEvent,
  track: LinearScoreTrackV2,
) {
  const articulation = event.articulation ?? "normal"
  const envelope = scoreTrackEnvelope(track)
  const attack = Math.min(0.8, Math.max(0.008, envelope.attack))
  const duration = Math.max(0.04, event.durationSeconds * articulationDurationFactor(articulation))
  const release = Math.min(3.5, Math.max(0.12, envelope.release))
  const velocity = Math.min(0.34, scoreVelocityGain(event.velocity) * 0.34)
  for (const midi of event.notes) {
    const begins = Math.max(context.currentTime, startAt + event.timeSeconds)
    const ends = begins + duration
    const gain = context.createGain()
    const oscillator = context.createOscillator()
    oscillator.type = track.synth === "bell" ? "sine" : track.synth === "bass" ? "triangle" : "sine"
    oscillator.frequency.setValueAtTime(midiNoteToFrequency(midi), begins)
    gain.gain.setValueAtTime(0.0001, begins)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocity), begins + attack)
    gain.gain.setValueAtTime(Math.max(0.0002, velocity * 0.72), ends)
    gain.gain.exponentialRampToValueAtTime(0.0001, ends + release)
    oscillator.connect(gain); gain.connect(destination)
    oscillator.start(begins); oscillator.stop(ends + release + 0.02)
    oscillator.addEventListener("ended", () => { oscillator.disconnect(); gain.disconnect() }, { once: true })
  }
}
