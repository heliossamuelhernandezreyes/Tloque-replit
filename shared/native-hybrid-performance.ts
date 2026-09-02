import { hybridEnabledForArticulation, nativeHybridForInstrument, type NativeHybridSource } from "./native-hybrid-source"
import type { LinearScoreRecipeV2 } from "./tloque-score-v2"

type ScoreEvent = LinearScoreRecipeV2["plan"]["events"][number]
type ScoreRest = LinearScoreRecipeV2["plan"]["rests"][number]

export const NATIVE_HYBRID_PERFORMANCE_VERSION = "tloque-native-hybrid-performance-v2" as const

export type NativeHybridTransition = "fresh-attack" | "connected-legato"

/** Renderer-neutral gain and transition policy consumed by every hybrid DSP family. */
export interface NativeHybridOverlayPerformance {
  contractVersion: typeof NATIVE_HYBRID_PERFORMANCE_VERSION
  transition: NativeHybridTransition
  mixScale: number
  wetCeiling: number
  excitationScale: number
}

export interface NativeHybridPerformanceDecision extends NativeHybridOverlayPerformance {
  eventKey: string
  phraseId: string
  event: ScoreEvent
  source: NativeHybridSource
  midis: readonly number[]
  legatoFromPrevious: boolean
  transitionFromMidi: number | null
  soundingHybridVoices: number
  voiceLimit: number
}

export interface NativeHybridPerformancePlan {
  version: typeof NATIVE_HYBRID_PERFORMANCE_VERSION
  decisions: readonly NativeHybridPerformanceDecision[]
  scheduledVoiceCount: number
  suppressedVoiceCount: number
}

const TIME_EPSILON = 1e-6
const MAX_LEGATO_GAP_SECONDS = 0.08
const MAX_LEGATO_OVERLAP_SECONDS = 0.12
const MAX_LEGATO_INTERVAL_SEMITONES = 12

function voiceLimitFor(source: NativeHybridSource) {
  if (source.physicalLayer === "sympathetic-resonance") return 6
  if (source.instrumentId.endsWith("-section")) return 6
  return 2
}

/** Preserve bass, soprano and evenly spaced inner voices when an authored chord
 * exceeds the physical overlay budget. The complete chord always remains in the
 * sample layer; only the subordinate resonator is thinned. */
export function selectHybridOverlayMidis(notes: readonly number[], source: NativeHybridSource) {
  const eligible = [...new Set(notes)]
    .filter(midi => midi >= source.midiMin && midi <= source.midiMax)
    .sort((left, right) => left - right)
  const limit = voiceLimitFor(source)
  if (eligible.length <= limit) return eligible
  const selected: number[] = []
  for (let index = 0; index < limit; index += 1) {
    const noteIndex = Math.round(index * (eligible.length - 1) / (limit - 1))
    const midi = eligible[noteIndex]
    if (selected[selected.length - 1] !== midi) selected.push(midi)
  }
  return selected
}

function explicitRestBreaksPhrase(rests: readonly ScoreRest[], previous: ScoreEvent, current: ScoreEvent) {
  return rests.some(rest =>
    rest.timeSeconds >= previous.timeSeconds - TIME_EPSILON &&
    rest.timeSeconds <= current.timeSeconds + TIME_EPSILON &&
    rest.timeSeconds + rest.durationSeconds > previous.timeSeconds + TIME_EPSILON,
  )
}

function connectedLegato(
  source: NativeHybridSource,
  previous: { event: ScoreEvent; midis: readonly number[] } | null,
  current: ScoreEvent,
  currentMidis: readonly number[],
  rests: readonly ScoreRest[],
) {
  if (!previous || source.physicalLayer === "sympathetic-resonance" || current.articulation !== "legato") return false
  if (previous.event.sectionId !== current.sectionId || previous.midis.length !== 1 || currentMidis.length !== 1) return false
  if (current.timeSeconds <= previous.event.timeSeconds + TIME_EPSILON) return false
  const gap = current.timeSeconds - (previous.event.timeSeconds + previous.event.durationSeconds)
  if (gap < -MAX_LEGATO_OVERLAP_SECONDS || gap > MAX_LEGATO_GAP_SECONDS) return false
  if (previous.midis[0] === currentMidis[0] || Math.abs(previous.midis[0] - currentMidis[0]) > MAX_LEGATO_INTERVAL_SEMITONES) return false
  return !explicitRestBreaksPhrase(rests, previous.event, current)
}

type DraftDecision = {
  eventKey: string
  phraseId: string
  event: ScoreEvent
  source: NativeHybridSource
  midis: readonly number[]
  legatoFromPrevious: boolean
  transitionFromMidi: number | null
}

/**
 * Compile one deterministic performance contract for realtime and offline renderers.
 * The recorded sample remains complete and dominant; this plan only governs the
 * subordinate physical layer.
 */
export function buildNativeHybridPerformancePlan(recipe: LinearScoreRecipeV2): NativeHybridPerformancePlan {
  const eventsByTrack = new Map<string, { event: ScoreEvent; ordinal: number }[]>()
  const restsByTrack = new Map<string, ScoreRest[]>()
  recipe.plan.tracks.forEach(track => { eventsByTrack.set(track.id, []); restsByTrack.set(track.id, []) })
  recipe.plan.events.forEach((event, ordinal) => eventsByTrack.get(event.trackId)?.push({ event, ordinal }))
  recipe.plan.rests.forEach(rest => restsByTrack.get(rest.trackId)?.push(rest))

  const drafts: DraftDecision[] = []
  let eligibleVoiceCount = 0
  for (const track of recipe.plan.tracks) {
    const source = nativeHybridForInstrument(track.instrument)
    if (!source) continue
    const trackEvents = eventsByTrack.get(track.id) ?? []
    trackEvents.sort((left, right) => left.event.timeSeconds - right.event.timeSeconds || left.ordinal - right.ordinal)
    const rests = restsByTrack.get(track.id) ?? []
    rests.sort((left, right) => left.timeSeconds - right.timeSeconds)
    let previous: { event: ScoreEvent; midis: readonly number[] } | null = null
    let phrase = 0

    for (const { event, ordinal } of trackEvents) {
      if (!hybridEnabledForArticulation(track.instrument, event.articulation)) { previous = null; continue }
      const allEligibleMidis = [...new Set(event.notes)].filter(midi => midi >= source.midiMin && midi <= source.midiMax)
      const midis = selectHybridOverlayMidis(allEligibleMidis, source)
      eligibleVoiceCount += allEligibleMidis.length
      if (!midis.length) { previous = null; continue }
      const legatoFromPrevious = connectedLegato(source, previous, event, midis, rests)
      if (!legatoFromPrevious) phrase += 1
      drafts.push({
        eventKey: `${track.id}:${event.timeSeconds}:${event.bar}:${event.beat}:${ordinal}`,
        phraseId: `${track.id}:phrase-${phrase}`,
        event,
        source,
        midis,
        legatoFromPrevious,
        transitionFromMidi: legatoFromPrevious ? previous?.midis[0] ?? null : null,
      })
      previous = { event, midis }
    }
  }

  const decisions: NativeHybridPerformanceDecision[] = []
  const draftsByTrack = new Map<string, DraftDecision[]>()
  for (const draft of drafts) {
    const bucket = draftsByTrack.get(draft.event.trackId) ?? []
    bucket.push(draft)
    draftsByTrack.set(draft.event.trackId, bucket)
  }
  for (const track of recipe.plan.tracks) {
    const trackDrafts = draftsByTrack.get(track.id) ?? []
    const activeEnds: number[] = []
    for (let index = 0; index < trackDrafts.length;) {
      const at = trackDrafts[index].event.timeSeconds
      for (let active = activeEnds.length - 1; active >= 0; active -= 1) if (activeEnds[active] <= at + TIME_EPSILON) activeEnds.splice(active, 1)
      let end = index + 1
      while (end < trackDrafts.length && Math.abs(trackDrafts[end].event.timeSeconds - at) <= TIME_EPSILON) end += 1
      const onsetVoices = trackDrafts.slice(index, end).reduce((sum, draft) => sum + draft.midis.length, 0)
      const soundingHybridVoices = activeEnds.length + onsetVoices
      for (let current = index; current < end; current += 1) {
        const draft = trackDrafts[current]
        const sectionScale = draft.source.instrumentId.endsWith("-section") ? 0.72 : 1
        const mixScale = Math.min(1, sectionScale / Math.sqrt(Math.max(1, soundingHybridVoices)))
        const transition: NativeHybridTransition = draft.legatoFromPrevious ? "connected-legato" : "fresh-attack"
        decisions.push({
          ...draft,
          contractVersion: NATIVE_HYBRID_PERFORMANCE_VERSION,
          transition,
          mixScale,
          wetCeiling: draft.source.wet * mixScale,
          excitationScale: transition === "connected-legato" ? 0.7 : 1,
          soundingHybridVoices,
          voiceLimit: voiceLimitFor(draft.source),
        })
      }
      for (let current = index; current < end; current += 1) {
        const draft = trackDrafts[current]
        const voiceEnd = draft.event.timeSeconds + Math.max(0, draft.event.durationSeconds)
        for (let voice = 0; voice < draft.midis.length; voice += 1) activeEnds.push(voiceEnd)
      }
      index = end
    }
  }

  decisions.sort((left, right) => left.event.timeSeconds - right.event.timeSeconds || left.event.trackId.localeCompare(right.event.trackId) || left.eventKey.localeCompare(right.eventKey))
  const scheduledVoiceCount = decisions.reduce((sum, decision) => sum + decision.midis.length, 0)
  return {
    version: NATIVE_HYBRID_PERFORMANCE_VERSION,
    decisions,
    scheduledVoiceCount,
    suppressedVoiceCount: Math.max(0, eligibleVoiceCount - scheduledVoiceCount),
  }
}

/** Apply the sample-dominance ceiling after calibration and expression response. */
export function boundedHybridOverlayGain(
  source: NativeHybridSource,
  requestedGain: number,
  performance?: NativeHybridOverlayPerformance,
) {
  const mixScale = Math.max(0, Math.min(1, performance?.mixScale ?? 1))
  const excitationScale = Math.max(0, Math.min(1, performance?.excitationScale ?? 1))
  const nominalCeiling = source.wet * mixScale
  const wetCeiling = Math.max(0, Math.min(nominalCeiling, performance?.wetCeiling ?? nominalCeiling))
  return Math.max(0, Math.min(wetCeiling, Math.max(0, requestedGain) * mixScale * excitationScale))
}
