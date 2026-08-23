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
  route: InstrumentArticulationRoute | null
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

export interface PerformanceRoutingPlan {
  channels: PerformanceChannel[]
  channelsForTrack(trackId: string): number[]
  channelForEvent(trackId: string, articulation?: string): number | undefined
}

export interface PerformancePlan extends PerformanceRoutingPlan {
  events: PerformanceEventDecision[]
  channelForEventIndex(eventIndex: number): number | undefined
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
  const exactRoute = manifest?.articulations.find(item => item.articulation === articulation) ?? null
  // A keyswitch-based sampler must actively return to its sustain/default state
  // after pizzicato/spiccato. If the requested technique is unavailable, use the
  // manifest's normal selector as an explicit reset without claiming that the
  // unsupported technique was actually recorded.
  const route = exactRoute ?? manifest?.articulations.find(item => item.articulation === "normal") ?? null
  const dedicated = Boolean(exactRoute && (
    exactRoute.program !== undefined || exactRoute.keyswitch !== undefined || exactRoute.controller !== undefined
  ))
  return {
    manifestId: manifest?.id ?? null,
    articulation,
    program: route?.program ?? baseProgram,
    source: dedicated ? "dedicated-articulation" : "base-program",
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

export function buildPerformanceRoutingPlan(
  tracks: readonly LinearScoreTrack[],
  events: readonly { trackId: string; articulation?: string }[],
  manifests: readonly InstrumentManifest[] = BUILTIN_INSTRUMENT_MANIFESTS,
  maxChannels = 16,
): PerformanceRoutingPlan {
  const playableTracks = tracks.slice(0, maxChannels)
  const tracksById = new Map(playableTracks.map(track => [track.id, track]))
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
  for (const event of events) {
    const track = tracksById.get(event.trackId)
    if (!track) continue
    const articulation = (event.articulation ?? "normal") as TloqueArticulation
    addChannel(track, resolvePerformanceRoute(track, articulation, manifests).program)
  }
  return {
    channels,
    channelsForTrack: trackId => channels.filter(config => config.track.id === trackId).map(config => config.channel),
    channelForEvent: (trackId, articulation = "normal") => {
      const track = tracksById.get(trackId)
      if (!track) return undefined
      const program = resolvePerformanceRoute(track, articulation as TloqueArticulation, manifests).program
      return channelByTrackProgram.get(`${track.id}:${program}`) ?? baseChannels.get(track.id)
    },
  }
}

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
    const startSeconds = "timeSeconds" in event ? event.timeSeconds : event.timeBeats * 60 / recipe.plan.bpm
    const durationSeconds = "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
    const previous = previousByTrack.get(track.id)
    const connected = Boolean(
      resolved.route?.articulation === articulation
      && resolved.route?.trueLegato
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
      route: resolved.route,
      velocityLayer: velocityLayerIndex(event.velocity, resolved.route?.velocityLayers ?? 1),
      roundRobin: deterministicRoundRobinIndex(recipe.plan.seed, identity, resolved.route?.roundRobins ?? 1),
      trueLegato: connected,
      releaseSamples: Boolean(resolved.route?.articulation === articulation && resolved.route?.releaseSamples),
      previousNotes: connected && previous ? previous.notes : null,
      identity,
    })
    previousByTrack.set(track.id, { notes: event.notes, endSeconds: startSeconds + durationSeconds })
  }

  const routing = buildPerformanceRoutingPlan(playableTracks, recipe.plan.events, manifests, maxChannels)
  const decisionByIndex = new Map(decisions.map(decision => [decision.eventIndex, decision]))
  return {
    ...routing,
    events: decisions,
    channelForEventIndex: eventIndex => {
      const decision = decisionByIndex.get(eventIndex)
      return decision ? routing.channelForEvent(decision.trackId, decision.articulation) : undefined
    },
    decisionForEvent: eventIndex => decisionByIndex.get(eventIndex),
  }
}
