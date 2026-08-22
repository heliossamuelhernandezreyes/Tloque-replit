import type { LinearScoreTrack } from "@shared/audio"

export const TLOQUE_SCORE_AUDIO_PROFILE = "tloque-score-audio-v2" as const

export interface ScoreEnvelope {
  attack: number
  decay: number
  sustain: number
  release: number
}

export interface ScoreTimbreProfile {
  filterHz: number
  filterQ: number
  level: number
}

export interface ScoreRenderProfile {
  polyphonyBudget: number
  reverbDecay: number
  reverbWet: number
  chorusWet: number
  stereoWidth: number
  makeup: number
  masterDrive: number
}

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

export function scoreVelocityGain(velocity: number): number {
  return Math.max(0, Math.min(1, velocity)) ** 0.8
}

export function scoreTrackEnvelope(track: LinearScoreTrack): ScoreEnvelope {
  const timing = "attack" in track
    ? { attack: track.attack, release: track.release }
    : track.synth === "pad" ? { attack: 1.1, release: 3.8 }
      : track.synth === "bell" ? { attack: 0.008, release: 2.4 }
        : track.synth === "pluck" ? { attack: 0.003, release: 0.7 }
          : track.synth === "bass" ? { attack: 0.02, release: 1.2 }
            : { attack: 0.12, release: 1.8 }
  if (track.synth === "pad") return { ...timing, decay: 0.9, sustain: 0.78 }
  if (track.synth === "bell") return { ...timing, decay: 1.35, sustain: 0.035 }
  if (track.synth === "pluck") return { ...timing, decay: 0.28, sustain: 0.06 }
  if (track.synth === "bass") return { ...timing, decay: 0.38, sustain: 0.62 }
  return { ...timing, decay: 0.55, sustain: 0.42 }
}

export function scoreTrackTimbre(track: LinearScoreTrack): ScoreTimbreProfile {
  if (track.synth === "pad") return { filterHz: 5_200, filterQ: 0.55, level: 0.98 }
  if (track.synth === "bell") return { filterHz: 7_600, filterQ: 0.7, level: 0.9 }
  if (track.synth === "pluck") return { filterHz: 6_400, filterQ: 0.8, level: 1 }
  if (track.synth === "bass") return { filterHz: 1_500, filterQ: 0.65, level: 0.82 }
  return { filterHz: 6_000, filterQ: 0.6, level: 1.08 }
}

export function scoreRenderProfile(quality: "core" | "studio" | "master" = "studio"): ScoreRenderProfile {
  if (quality === "core") {
    return { polyphonyBudget: 32, reverbDecay: 2.4, reverbWet: 0.1, chorusWet: 0.04, stereoWidth: 0.56, makeup: 1.18, masterDrive: 1.46 }
  }
  if (quality === "master") {
    return { polyphonyBudget: 64, reverbDecay: 4.2, reverbWet: 0.2, chorusWet: 0.1, stereoWidth: 0.68, makeup: 1.34, masterDrive: 1.72 }
  }
  return { polyphonyBudget: 48, reverbDecay: 3.2, reverbWet: 0.16, chorusWet: 0.08, stereoWidth: 0.62, makeup: 1.28, masterDrive: 1.62 }
}
