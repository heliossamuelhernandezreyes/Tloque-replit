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
    .map((event, index) => ({ event, index, start: eventStart(recipe, event), duration: eventDuration(recipe, event) }))
    .filter(item => !playableTrackIds || playableTrackIds.has(item.event.trackId))
    .sort((left, right) => left.start - right.start || left.index - right.index)
  const sectionGroups = new Map<string, number[]>()
  const groups: typeof ordered[] = []
  for (const item of ordered) {
    const previous = groups.at(-1)
    if (!previous || Math.abs(previous[0].start - item.start) > EPSILON) groups.push([item])
    else previous.push(item)
  }
  groups.forEach((group, index) => {
    const key = sectionId(group[0].event)
    const indices = sectionGroups.get(key) ?? []
    indices.push(index)
    sectionGroups.set(key, indices)
  })

  const decisions = new Map<number, OrchestraConductorGesture>()
  let memoryEnergy = 0.5
  let previousTarget = 0.5
  let previousStart = groups[0]?.[0].start ?? 0
  let previousSection = groups[0] ? sectionId(groups[0][0].event) : "score"
  const activeEnds: { end: number; trackId: string; notes: number }[] = []

  groups.forEach((group, groupIndex) => {
    const start = group[0].start
    for (let index = activeEnds.length - 1; index >= 0; index -= 1) if (activeEnds[index].end <= start + EPSILON) activeEnds.splice(index, 1)
    const currentSection = sectionId(group[0].event)
    const sectionPositions = sectionGroups.get(currentSection) ?? [groupIndex]
    const position = Math.max(0, sectionPositions.indexOf(groupIndex))
    const progress = sectionPositions.length <= 1 ? 0.5 : position / (sectionPositions.length - 1)
    const soundingTracks = new Set([...activeEnds.map(item => item.trackId), ...group.map(item => item.event.trackId)])
    const soundingNotes = activeEnds.reduce((sum, item) => sum + item.notes, 0) + group.reduce((sum, item) => sum + item.event.notes.length, 0)
    const density = clamp(soundingTracks.size / 8 * 0.55 + soundingNotes / 24 * 0.45, 0, 1)
    const noteCount = group.reduce((sum, item) => sum + item.event.notes.length, 0)
    const velocity = group.reduce((sum, item) => sum + item.event.velocity * item.event.notes.length, 0) / Math.max(1, noteCount)
    const target = clamp(velocity * 0.73 + density * 0.27, 0.08, 1)
    const gap = Math.max(0, start - previousStart)
    const sectionChanged = currentSection !== previousSection
    const audibleSilence = activeEnds.length === 0 && gap >= Math.max(0.22, 60 / recipe.plan.bpm * 0.42)
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
        balanceScale: roleBalance(roleFor(track), density, phase),
        colourScale: clamp(0.96 + ensembleEnergy * 0.08 - density * 0.025, 0.94, 1.06),
        attackCohesionScale: clamp(1.035 - ensembleEnergy * 0.085 + (phase === "release" ? 0.035 : 0), 0.9, 1.08),
        releaseCohesionScale: clamp(0.96 + memoryEnergy * 0.12 + (phase === "release" ? 0.035 : 0), 0.94, 1.12),
        sectionSpreadSeconds: isSection ? clamp(0.001 + density * 0.003, 0, 0.004) : 0,
        sectionSpreadCents: isSection ? clamp(1.2 + density * 1.8, 0, 3) : 0,
      })
    }
    for (const item of group) activeEnds.push({ end: start + Math.max(0, item.duration), trackId: item.event.trackId, notes: item.event.notes.length })
    previousTarget = ensembleEnergy
    previousStart = start
    previousSection = currentSection
  })

  return { version: ORCHESTRA_CONDUCTOR_VERSION, ruleVersion: ORCHESTRA_CONDUCTOR_RULE_VERSION, decisions }
}

/** Symmetric member spread; member zero remains centered for a solo source. */
export function orchestraSectionMemberOffset(member: number, members: number, spread: number) {
  if (members <= 1) return 0
  return clamp((member / (members - 1) * 2 - 1) * spread, -spread, spread)
}

/** Causal timing spread: no member may be scheduled before an event at t=0. */
export function orchestraSectionMemberDelay(member: number, members: number, spreadSeconds: number) {
  if (members <= 1) return 0
  return clamp(member / (members - 1) * spreadSeconds, 0, spreadSeconds)
}
