import type { LinearScoreTrack } from "@shared/audio"

export function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

export function midiNotesToFrequencies(notes: readonly number[]): number[] {
  return notes.map(midiNoteToFrequency)
}

export function articulationDurationFactor(articulation = "normal"): number {
  if (articulation === "staccato") return 0.55
  if (articulation === "legato") return 1.08
  return 0.96
}

export function scoreTrackEnvelope(track: LinearScoreTrack): { attack: number; release: number } {
  if ("attack" in track) return { attack: track.attack, release: track.release }
  if (track.synth === "pad") return { attack: 1.1, release: 3.8 }
  if (track.synth === "bell") return { attack: 0.008, release: 2.4 }
  if (track.synth === "pluck") return { attack: 0.003, release: 0.7 }
  if (track.synth === "bass") return { attack: 0.02, release: 1.2 }
  return { attack: 0.12, release: 1.8 }
}
