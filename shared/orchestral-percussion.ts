export const ORCHESTRAL_PERCUSSION_HITS = {
  "bass-drum": 36,
  "snare-taps": 37,
  "snare-hit": 38,
  "snare-roll": 39,
  "snare-hit-alt": 40,
  "snare-roll-alt": 41,
  "crash-cymbal": 49,
  "suspended-cymbal": 51,
  "tambourine-shake": 53,
  "tambourine-hit": 54,
  "tambourine-roll": 55,
  cowbell: 56,
  "suspended-cymbal-stick": 59,
  "triangle-muted-small": 78,
  "triangle-open-small": 79,
  "triangle-muted-large": 80,
  "triangle-open-large": 81,
  "sleigh-bells": 82,
} as const

export type OrchestralPercussionHit = keyof typeof ORCHESTRAL_PERCUSSION_HITS

export function orchestralPercussionMidiFor(value: string): number | null {
  return ORCHESTRAL_PERCUSSION_HITS[value as OrchestralPercussionHit] ?? null
}

export function isOrchestralPercussionHit(value: string): value is OrchestralPercussionHit {
  return Object.prototype.hasOwnProperty.call(ORCHESTRAL_PERCUSSION_HITS, value)
}
