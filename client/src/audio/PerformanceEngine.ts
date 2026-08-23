import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import {
  BUILTIN_INSTRUMENT_MANIFESTS,
  type InstrumentArticulationRoute,
  type InstrumentManifest,
  type TloqueArticulation,
} from "@shared/instrument-manifest"

export interface PerformanceRoute {
  manifestId: string | null
  articulation: TloqueArticulation
  program: number
  source: "dedicated-articulation" | "base-program"
  route: InstrumentArticulationRoute | null
}

export interface PerformanceEventDecision {
  eventIndex: number
  trackId: string
  articulation: TloqueArticulation
  program: number
  source: PerformanceRoute["source"]
  manifestId: string | null
  velocityLayer: number
  roundRobin: number
  trueLegato: boolean
  releaseSamples: boolean
  previousNotes: readonly number[] | null
  identity: string
}

export interface PerformanceChannel {
  channel: number
  track: LinearScoreTrack
  program: number
}

export interface PerformancePlan {
  channels: PerformanceChannel[]
  events: PerformanceEventDecision[]
  channelsForTrack(trackId: string): number[]
  channelForEvent(eventIndex: number): number | undefined
  decisionForEvent(eventIndex: number): PerformanceEventDecision | undefined
}

export function baseProgramForTrack(track: LinearScoreTrack): number {
  if ("program" in track) return track.program
  return ({ warm: 0, pad: 48, bell: 8, pluck: 24, bass: 32 } as const)[track.synth]
}

function semanticInstrumentId(track: LinearScoreTrack): string | null {
  return "instrument" in track ? track.instrument : null
}

export function resolveInstrumentManifest(
  track: LinearScoreTrack,
  manifests: readonly InstrumentManifest[] = BUILTIN_INSTRUMENT_MANIFESTS,
): InstrumentManifest | null {
  const instrument = semanticInstrumentId(track)
  const program = baseProgramForTrack(track)

  if (instrument) {
    const exact = manifests.find(manifest => manifest.instruments.includes(instrument))
    if (exact) return exact
  }
  return manifests.find(manifest => manifest.basePrograms.includes(program)) ?? null
}

export function resolvePerformanceRoute(
  track: LinearScoreTrack,
  articulation: TloqueArticulation = "normal",
  manifests: readonly InstrumentManifest[] = BUILTIN_INSTRUMENT_MANIFESTS,
): PerformanceRoute {
  const baseProgram = baseProgramForTrack(track)
  const manifest = resolveInstrumentManifest(track, manifests)
  const route = manifest?.articulations.find(item => item.articulation === articulation) ?? null

  return {
    manifestId: manifest?.id ?? null,
    articulation,
    program: route?.program ?? baseProgram,
    source: route?.program === undefined ? "base-program" : "dedicated-articulation",
    route,
  }
}

/** Stable renderer-neutral selector for recorded alternate attacks. */
export function deterministicRoundRobinIndex(seed: number, identity: string, count: number): number {
  if (!Number.isInteger(count) || count <= 1) return 0
  let hash = (seed ^ 0x811c9dc5) >>> 0
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % count
}

export function velocityLayerIndex(velocity: number, layers: number): number {
  if (!Number.isInteger(layers) || layers <= 1) return 0
  return Math.min(layers - 1, Math.floor(Math.max(0, Math.min(0.999999, velocity)) * layers))
}

function eventIdentity(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number], index: number) {
  const articulation = "articulation" in event ? event.articulation : "normal"
  const time = "timeSeconds" in event ? event.timeSeconds : event.timeBeats
  return `${recipe.plan.seed}:${index}:${event.trackId}:${time}:${event.notes.join(",")}:${articulation}`
}

/**
 * Compiles score semantics into renderer-neutral acoustic decisions. Both live
 * SoundFont playback and sampled WAV export consume this same plan.
 */
export function buildPerformancePlan(
  recipe: LinearScoreRecipe,
  manifests: readonly InstrumentManifest[] = BUILTIN_INSTRUMENT_MANIFESTS,
  maxChannels = 16,
): PerformancePlan {
  const playableTracks = recipe.plan.tracks.slice(0, maxChannels)
  const tracksById = new Map(playableTracks.map(track => [track.id, track]))
  const previousByTrack = new Map<string, { notes: readonly number[]; endSeconds: number }>()

  const decisions: PerformanceEventDecision[] = []
  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const track = tracksById.get(event.trackId)
    if (!track) continue
    const articulation = ("articulation" in event ? event.articulation : "normal") as TloqueArticulation
    const resolved = resolvePerformanceRoute(track, articulation, manifests)
    const identity = eventIdentity(recipe, event, eventIndex)
    const velocityLayers = resolved.route?.velocityLayers ?? 1
    const roundRobins = resolved.route?.roundRobins ?? 1
    const startSeconds = "timeSeconds" in event ? event.timeSeconds : event.timeBeats * 60 / recipe.plan.bpm
    const durationSeconds = "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
    const previous = previousByTrack.get(track.id)
    const connected = Boolean(
      resolved.route?.trueLegato
      && previous
      && previous.notes.length === 1
      && event.notes.length === 1
      && startSeconds - previous.endSeconds <= 0.08,
    )
    decisions.push({
      eventIndex,
      trackId: track.id,
      articulation,
      program: resolved.program,
      source: resolved.source,
      manifestId: resolved.manifestId,
      velocityLayer: velocityLayerIndex(event.velocity, velocityLayers),
      roundRobin: deterministicRoundRobinIndex(recipe.plan.seed, identity, roundRobins),
      trueLegato: connected,
      releaseSamples: Boolean(resolved.route?.releaseSamples),
      previousNotes: connected && previous ? previous.notes : null,
      identity,
    })
    previousByTrack.set(track.id, { notes: event.notes, endSeconds: startSeconds + durationSeconds })
  }

  const baseChannels = new Map<string, number>()
  const channelByTrackProgram = new Map<string, number>()
  const channels: PerformanceChannel[] = []
  const addChannel = (track: LinearScoreTrack, program: number) => {
    const key = `${track.id}:${program}`
    const existing = channelByTrackProgram.get(key)
    if (existing !== undefined) return existing
    if (channels.length >= maxChannels) return baseChannels.get(track.id)
    const channel = channels.length
    channels.push({ channel, track, program })
    channelByTrackProgram.set(key, channel)
    if (!baseChannels.has(track.id)) baseChannels.set(track.id, channel)
    return channel
  }

  for (const track of playableTracks) addChannel(track, baseProgramForTrack(track))
  for (const decision of decisions) {
    const track = tracksById.get(decision.trackId)
    if (track) addChannel(track, decision.program)
  }

  const decisionByIndex = new Map(decisions.map(decision => [decision.eventIndex, decision]))
  return {
    channels,
    events: decisions,
    channelsForTrack: trackId => channels.filter(config => config.track.id === trackId).map(config => config.channel),
    channelForEvent: eventIndex => {
      const decision = decisionByIndex.get(eventIndex)
      if (!decision) return undefined
      return channelByTrackProgram.get(`${decision.trackId}:${decision.program}`) ?? baseChannels.get(decision.trackId)
    },
    decisionForEvent: eventIndex => decisionByIndex.get(eventIndex),
  }
}
