import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import {
  ORCHESTRA_CONDUCTOR_RULE_VERSION,
  ORCHESTRA_CONDUCTOR_VERSION,
  type OrchestraConductorGesture,
  type OrchestraEnsemblePhase,
} from "@shared/orchestra-conductor"

type ScoreEvent = LinearScoreRecipe["plan"]["events"][number]
type TrackRole = "melody" | "harmony" | "bass" | "pulse" | "texture" | "accent"

export interface OrchestraConductorPlan {
  version: typeof ORCHESTRA_CONDUCTOR_VERSION
  ruleVersion: typeof ORCHESTRA_CONDUCTOR_RULE_VERSION
  decisions: ReadonlyMap<number, OrchestraConductorGesture>
}

const EPSILON = 1e-6
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low))
const eventStart = (recipe: LinearScoreRecipe, event: ScoreEvent) => "timeSeconds" in event ? event.timeSeconds : event.timeBeats * 60 / recipe.plan.bpm
const eventMusicalStart = (event: ScoreEvent) => event.timeBeats
const eventDuration = (recipe: LinearScoreRecipe, event: ScoreEvent) => "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
const sectionId = (event: ScoreEvent) => "sectionId" in event ? event.sectionId : "score"
const roleFor = (track: LinearScoreTrack): TrackRole => "role" in track ? track.role : "harmony"
const instrumentFor = (track: LinearScoreTrack) => "instrument" in track ? track.instrument : ""

function phaseFor(progress: number, energy: number, previousEnergy: number): OrchestraEnsemblePhase {
  if (progress <= 0.12) return "entry"
  if (progress >= 0.82 || energy < previousEnergy - 0.08) return "release"
  if (energy >= 0.7 || progress >= 0.58) return "crest"
  return "build"
}

function roleBalance(role: TrackRole, density: number, phase: OrchestraEnsemblePhase) {
  const crest = phase === "crest" ? 1 : 0
  if (role === "melody") return clamp(1 + density * 0.055 + crest * 0.015, 0.94, 1.08)
  if (role === "accent") return clamp(1 + (1 - density) * 0.025, 0.96, 1.04)
  if (role === "bass") return clamp(1 - density * 0.018, 0.94, 1.02)
  if (role === "pulse") return clamp(1 - density * 0.06, 0.9, 1)
  if (role === "texture") return clamp(1 - density * 0.1, 0.86, 1)
  return clamp(1 - density * 0.07, 0.88, 1)
}

/** Build one deterministic ensemble memory shared by realtime and offline paths.
 * Simultaneous events receive the same energy, density and phase;
 * only role balance and verified section spread are track-specific. */
export function buildOrchestraConductorPlan(recipe: LinearScoreRecipe, playableTrackIds?: ReadonlySet<string>): OrchestraConductorPlan {
  const tracks = new Map(recipe.plan.tracks.map(track => [track.id, track]))
  const ordered = recipe.plan.events
    .map((event, index) => ({
      event,
      index,
      start: eventStart(recipe, event),
      musicalStart: eventMusicalStart(event),
      duration: eventDuration(recipe, event),
    }))
    .filter(item => !playableTrackIds || playableTrackIds.has(item.event.trackId))
    .sort((left, right) => left.musicalStart - right.musicalStart || left.index - right.index)
  const groups: typeof ordered[] = []
  for (const item of ordered) {
    const previous = groups.at(-1)
    // V2 humanization deliberately moves rendered seconds. Musical simultaneity
    // remains the authored beat position and must receive one shared gesture.
    if (!previous || Math.abs(previous[0].musicalStart - item.musicalStart) > EPSILON) groups.push([item])
    else previous.push(item)
  }
  const sectionGroupCounts = new Map<string, number>()
  for (const group of groups) {
    const key = sectionId(group[0].event)
    sectionGroupCounts.set(key, (sectionGroupCounts.get(key) ?? 0) + 1)
  }
  const sectionGroupPositions = new Map<string, number>()

  const decisions = new Map<number, OrchestraConductorGesture>()
  let memoryEnergy = 0.5
  let previousTarget = 0.5
  let previousStart = groups[0] ? Math.min(...groups[0].map(item => item.start)) : 0
  let latestAudibleEnd = previousStart
  let previousSection = groups[0] ? sectionId(groups[0][0].event) : "score"
  const activeEnds: { end: number; trackId: string; notes: number }[] = []

  groups.forEach(group => {
    const start = Math.min(...group.map(item => item.start))
    for (let index = activeEnds.length - 1; index >= 0; index -= 1) if (activeEnds[index].end <= start + EPSILON) activeEnds.splice(index, 1)
    const currentSection = sectionId(group[0].event)
    const position = sectionGroupPositions.get(currentSection) ?? 0
    sectionGroupPositions.set(currentSection, position + 1)
    const sectionLength = sectionGroupCounts.get(currentSection) ?? 1
    const progress = sectionLength <= 1 ? 0.5 : position / (sectionLength - 1)
    const soundingTracks = new Set([...activeEnds.map(item => item.trackId), ...group.map(item => item.event.trackId)])
    const soundingNotes = activeEnds.reduce((sum, item) => sum + item.notes, 0) + group.reduce((sum, item) => sum + item.event.notes.length, 0)
    const density = clamp(soundingTracks.size / 8 * 0.55 + soundingNotes / 24 * 0.45, 0, 1)
    const noteCount = group.reduce((sum, item) => sum + item.event.notes.length, 0)
    const velocity = group.reduce((sum, item) => sum + item.event.velocity * item.event.notes.length, 0) / Math.max(1, noteCount)
    const target = clamp(velocity * 0.73 + density * 0.27, 0.08, 1)
    const gap = Math.max(0, start - previousStart)
    const sectionChanged = currentSection !== previousSection
    const audibleGapSeconds = activeEnds.length === 0 ? Math.max(0, start - latestAudibleEnd) : 0
    const audibleSilence = audibleGapSeconds >= Math.max(0.22, 60 / recipe.plan.bpm * 0.42)
    if (sectionChanged) memoryEnergy = target * 0.68 + 0.16
    else if (audibleSilence) memoryEnergy = memoryEnergy * 0.32 + target * 0.68
    else {
      const carry = Math.exp(-gap / 2.8)
      memoryEnergy = memoryEnergy * carry + target * (1 - carry)
    }
    memoryEnergy = clamp(memoryEnergy, 0.08, 1)
    const ensembleEnergy = clamp(target * 0.62 + memoryEnergy * 0.38, 0.08, 1)
    const phase = phaseFor(progress, ensembleEnergy, previousTarget)
    for (const item of group) {
      const track = tracks.get(item.event.trackId)
      if (!track) continue
      const isSection = instrumentFor(track).endsWith("-section")
      decisions.set(item.index, {
        contractVersion: ORCHESTRA_CONDUCTOR_VERSION,
        ruleVersion: ORCHESTRA_CONDUCTOR_RULE_VERSION,
        ensemblePhase: phase,
        ensembleEnergy,
        memoryEnergy,
        density,
        audibleGapSeconds: clamp(audibleGapSeconds, 0, 30),
        balanceScale: roleBalance(roleFor(track), density, phase),
        colourScale: clamp(0.96 + ensembleEnergy * 0.08 - density * 0.025, 0.94, 1.06),
        attackCohesionScale: clamp(1.035 - ensembleEnergy * 0.085 + (phase === "release" ? 0.035 : 0), 0.9, 1.08),
        releaseCohesionScale: clamp(0.96 + memoryEnergy * 0.12 + (phase === "release" ? 0.035 : 0), 0.94, 1.12),
        sectionSpreadSeconds: isSection ? clamp(0.001 + density * 0.003, 0, 0.004) : 0,
        sectionSpreadCents: isSection ? clamp(1.2 + density * 1.8, 0, 3) : 0,
      })
    }
    for (const item of group) {
      const end = item.start + Math.max(0, item.duration)
      activeEnds.push({ end, trackId: item.event.trackId, notes: item.event.notes.length })
      latestAudibleEnd = Math.max(latestAudibleEnd, end)
    }
    previousTarget = ensembleEnergy
    previousStart = start
    previousSection = currentSection
  })

  return { version: ORCHESTRA_CONDUCTOR_VERSION, ruleVersion: ORCHESTRA_CONDUCTOR_RULE_VERSION, decisions }
}

/** Symmetric member spread; member zero remains centered for a solo source.
 * A two-member low-register preview receives a tightly capped frequency-domain
 * floor so fixed-cent detune cannot collapse into an extremely slow beat. */
export function orchestraSectionMemberOffset(member: number, members: number, spread: number, frequencyHz?: number) {
  if (members <= 1) return 0
  const boundedSpread = Math.max(0, Number.isFinite(spread) ? spread : 0)
  let effectiveSpread = boundedSpread
  if (members === 2 && boundedSpread > 0 && frequencyHz !== undefined && Number.isFinite(frequencyHz) && frequencyHz > 0) {
    const minimumPairBeatHz = 0.45
    const requiredHalfCents = 1200 / Math.LN2 * Math.asinh(minimumPairBeatHz / (2 * frequencyHz))
    effectiveSpread = Math.min(8, boundedSpread + 3, Math.max(boundedSpread, requiredHalfCents))
  }
  return clamp((member / (members - 1) * 2 - 1) * effectiveSpread, -effectiveSpread, effectiveSpread)
}

/** Causal timing spread: no member may be scheduled before an event at t=0. */
export function orchestraSectionMemberDelay(member: number, members: number, spreadSeconds: number) {
  if (members <= 1) return 0
  return clamp(member / (members - 1) * spreadSeconds, 0, spreadSeconds)
}
