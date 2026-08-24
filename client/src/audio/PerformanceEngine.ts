import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import {
  BUILTIN_INSTRUMENT_MANIFESTS,
  type InstrumentArticulationRoute,
  type InstrumentManifest,
  type TloqueArticulation,
} from "@shared/instrument-manifest"
import { directPerformanceEvent } from "./PerformanceDirector"

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
  startOffsetSeconds: number
  durationScale: number
  velocityScale: number
  phraseStart: boolean
  phraseEnd: boolean
  directorReasons: readonly string[]
  identity: string
}

export interface FamilyPerformanceHumanization {
  startOffsetSeconds: number
  durationScale: number
  velocityScale: number
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

function deterministicUnit(identity: string, salt: string) {
  let hash = 0x811c9dc5
  const value = `${salt}:${identity}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash >>> 0) / 0xffffffff
}

/**
 * Renderer-neutral micro-performance. This never fabricates an articulation or sample:
 * it only adjusts attack placement, note length and performed velocity within conservative
 * family-specific bounds. `humanize=0` is bit-for-bit neutral; larger values progressively
 * expose bow asymmetry, breath separation and ensemble looseness while remaining deterministic.
 */
export function familyPerformanceHumanization(
  instrument: string | null,
  humanize: number,
  identity: string,
  articulation: TloqueArticulation,
  ordinal: number,
): FamilyPerformanceHumanization {
  const amount = Math.max(0, Math.min(1, humanize))
  if (amount === 0 || !instrument) return { startOffsetSeconds: 0, durationScale: 1, velocityScale: 1 }

  const timingNoise = deterministicUnit(identity, "timing") * 2 - 1
  const durationNoise = deterministicUnit(identity, "duration") * 2 - 1
  const velocityNoise = deterministicUnit(identity, "velocity") * 2 - 1
  const legatoLike = articulation === "legato" || articulation === "tenuto"
  let timingMs = 8
  let durationSpread = 0.012
  let velocitySpread = 0.018
  let durationBias = 0
  let velocityBias = 0

  if (instrument === "strings.violin") {
    timingMs = 12; durationSpread = 0.018; velocitySpread = 0.026
    velocityBias = (ordinal % 2 === 0 ? 0.012 : -0.012) * amount
  } else if (instrument.startsWith("strings.")) {
    timingMs = instrument === "strings.violin-section" ? 22 : 16
    durationSpread = 0.022; velocitySpread = 0.026
    velocityBias = (ordinal % 2 === 0 ? 0.008 : -0.008) * amount
  } else if (instrument.startsWith("woodwinds.")) {
    timingMs = 15; durationSpread = 0.018; velocitySpread = 0.022
    if (!legatoLike) durationBias = -0.025 * amount
  } else if (instrument.startsWith("brass.")) {
    timingMs = 18; durationSpread = 0.020; velocitySpread = 0.028
    if (!legatoLike) durationBias = -0.032 * amount
  } else if (instrument.startsWith("percussion.")) {
    timingMs = 7; durationSpread = 0.006; velocitySpread = 0.035
  } else if (instrument.startsWith("guitar.")) {
    timingMs = 14; durationSpread = 0.018; velocitySpread = 0.028
  } else if (instrument === "piano.grand") {
    timingMs = 10; durationSpread = 0.010; velocitySpread = 0.025
  } else if (instrument.startsWith("keys.pipe-organ")) {
    timingMs = 3; durationSpread = 0.004; velocitySpread = 0.006
  } else if (instrument === "keys.harpsichord") {
    timingMs = 7; durationSpread = 0.008; velocitySpread = 0.018
  }

  const startOffsetSeconds = timingNoise * timingMs * amount / 1000
  const durationScale = Math.max(0.86, Math.min(1.08, 1 + durationBias + durationNoise * durationSpread * amount))
  const velocityScale = Math.max(0.88, Math.min(1.12, 1 + velocityBias + velocityNoise * velocitySpread * amount))
  return { startOffsetSeconds, durationScale, velocityScale }
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
  const ordinalByTrack = new Map<string, number>()
  const decisions: PerformanceEventDecision[] = []
  const humanize = recipe.version === 2 ? recipe.plan.humanize : 0

  const indicesByTrack = new Map<string, number[]>()
  for (let index = 0; index < recipe.plan.events.length; index += 1) {
    const event = recipe.plan.events[index]
    const items = indicesByTrack.get(event.trackId) ?? []
    items.push(index)
    indicesByTrack.set(event.trackId, items)
  }
  const neighbours = new Map<number, { previous: number | null; next: number | null }>()
  for (const indices of indicesByTrack.values()) {
    for (let position = 0; position < indices.length; position += 1) {
      neighbours.set(indices[position], {
        previous: position > 0 ? indices[position - 1] : null,
        next: position + 1 < indices.length ? indices[position + 1] : null,
      })
    }
  }

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
    const ordinal = ordinalByTrack.get(track.id) ?? 0
    ordinalByTrack.set(track.id, ordinal + 1)
    const performed = familyPerformanceHumanization(semanticInstrumentId(track), humanize, identity, articulation, ordinal)
    const neighbour = neighbours.get(eventIndex)
    const director = directPerformanceEvent(recipe, {
      track,
      event,
      previous: neighbour?.previous === null || neighbour?.previous === undefined ? null : recipe.plan.events[neighbour.previous],
      next: neighbour?.next === null || neighbour?.next === undefined ? null : recipe.plan.events[neighbour.next],
      articulation,
    })
    const startOffsetSeconds = Math.max(-0.04, Math.min(0.04, performed.startOffsetSeconds + director.startOffsetSeconds))
    const durationScale = Math.max(0.84, Math.min(1.10, performed.durationScale * director.durationScale))
    const velocityScale = Math.max(0.86, Math.min(1.14, performed.velocityScale * director.velocityScale))
    const performedVelocity = Math.max(0.01, Math.min(1, event.velocity * velocityScale))
    decisions.push({
      eventIndex,
      trackId: track.id,
      articulation,
      program: resolved.program,
      source: resolved.source,
      manifestId: resolved.manifestId,
      route: resolved.route,
      velocityLayer: velocityLayerIndex(performedVelocity, resolved.route?.velocityLayers ?? 1),
      roundRobin: deterministicRoundRobinIndex(recipe.plan.seed, identity, resolved.route?.roundRobins ?? 1),
      trueLegato: connected,
      releaseSamples: Boolean(resolved.route?.articulation === articulation && resolved.route?.releaseSamples),
      previousNotes: connected && previous ? previous.notes : null,
      startOffsetSeconds,
      durationScale,
      velocityScale,
      phraseStart: director.phraseStart,
      phraseEnd: director.phraseEnd,
      directorReasons: director.reason,
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
