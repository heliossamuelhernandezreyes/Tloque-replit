import type { LinearScoreRecipe, LinearScoreTrack } from "@shared/audio"
import type { LinearScoreRecipeV2 } from "@shared/tloque-score-v2"
import {
  BUILTIN_INSTRUMENT_MANIFESTS,
  type InstrumentArticulationRoute,
  type InstrumentManifest,
  type TloqueArticulation,
} from "@shared/instrument-manifest"
import {
  UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION,
  directPerformanceEvent,
  type MetricEmphasis,
  type PerformancePhraseContext,
} from "./PerformanceDirector"

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
  phraseIndex: number
  phrasePosition: number
  phraseLength: number
  phraseProgress: number
  phraseClimaxPosition: number
  metricEmphasis: MetricEmphasis
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
  directorVersion: typeof UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION
  events: PerformanceEventDecision[]
  channelForEventIndex(eventIndex: number): number | undefined
  decisionForEvent(eventIndex: number): PerformanceEventDecision | undefined
}

export interface PerformedEventValues {
  startSeconds: number
  durationSeconds: number
  velocity: number
}

export function baseProgramForTrack(track: LinearScoreTrack): number {
  if ("program" in track) return track.program
  return ({ warm: 0, pad: 48, bell: 8, pluck: 24, bass: 32 } as const)[track.synth]
}

function semanticInstrumentId(track: LinearScoreTrack): string | null {
  return "instrument" in track ? track.instrument : null
}

type ScoreEvent = LinearScoreRecipe["plan"]["events"][number]
type ScoreRestV2 = LinearScoreRecipeV2["plan"]["rests"][number]

function eventStartSeconds(recipe: LinearScoreRecipe, event: ScoreEvent) {
  return "timeSeconds" in event ? event.timeSeconds : event.timeBeats * 60 / recipe.plan.bpm
}

function eventDurationSeconds(recipe: LinearScoreRecipe, event: ScoreEvent) {
  return "durationSeconds" in event ? event.durationSeconds : event.durationBeats * 60 / recipe.plan.bpm
}

function metricEmphasisFor(recipe: LinearScoreRecipe, event: ScoreEvent): MetricEmphasis {
  const beat = event.beat
  const { numerator, denominator } = recipe.plan.meter
  if (Math.abs(beat - 1) < 1e-6) return "primary"
  if (denominator === 8 && numerator >= 6 && numerator % 3 === 0) {
    const groupOffset = beat - 1
    if (Math.abs(groupOffset - Math.round(groupOffset)) < 1e-6 && Math.round(groupOffset) % 3 === 0) return "secondary"
  }
  if (numerator >= 4 && numerator % 2 === 0 && Math.abs(beat - (numerator / 2 + 1)) < 1e-6) return "secondary"
  return "light"
}

function sectionBeatSeconds(recipe: LinearScoreRecipe, event: ScoreEvent) {
  if (recipe.version !== 2 || !("sectionId" in event)) return 60 / recipe.plan.bpm
  const section = recipe.plan.sections.find(item => item.id === event.sectionId)
  return 60 / (section?.bpm ?? recipe.plan.bpm)
}

function explicitRestBreaksPhrase(recipe: LinearScoreRecipe, previous: ScoreEvent, current: ScoreEvent, rests: readonly ScoreRestV2[]) {
  if (recipe.version !== 2 || !rests.length) return false
  const previousStart = eventStartSeconds(recipe, previous)
  const previousEnd = previousStart + eventDurationSeconds(recipe, previous)
  const currentStart = eventStartSeconds(recipe, current)
  let low = 0
  let high = rests.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rests[middle].timeSeconds < previousStart - 1e-6) low = middle + 1
    else high = middle
  }
  for (let index = low; index < rests.length && rests[index].timeSeconds < currentStart - 1e-6; index += 1) {
    if (rests[index].timeSeconds + rests[index].durationSeconds > previousEnd - 1e-6) return true
  }
  return false
}

function phraseClimaxPosition(recipe: LinearScoreRecipe, indices: readonly number[], track: LinearScoreTrack) {
  if (indices.length <= 2) return Math.max(0, indices.length - 1)
  const events = indices.map(index => recipe.plan.events[index])
  const pitches = events.map(event => event.notes.reduce((sum, note) => sum + note, 0) / event.notes.length)
  const minPitch = Math.min(...pitches)
  const pitchSpan = Math.max(1, Math.max(...pitches) - minPitch)
  const role = "role" in track ? track.role : "harmony"
  const pitchWeight = role === "melody" || role === "accent" ? 0.38 : role === "bass" ? 0.18 : 0.12
  let winner = 0
  let winnerScore = Number.NEGATIVE_INFINITY
  for (let position = 0; position < events.length; position += 1) {
    const event = events[position]
    const progress = position / (events.length - 1)
    const preferredLatePeak = 1 - Math.min(1, Math.abs(progress - 0.62) / 0.62)
    const metric = metricEmphasisFor(recipe, event) === "primary" ? 1 : metricEmphasisFor(recipe, event) === "secondary" ? 0.5 : 0
    const articulationEnergy = "articulation" in event && event.articulation === "accent" ? 1 : 0
    const score = ((pitches[position] - minPitch) / pitchSpan) * pitchWeight
      + event.velocity * 0.34
      + preferredLatePeak * 0.2
      + metric * 0.06
      + articulationEnergy * 0.12
    if (score > winnerScore) {
      winner = position
      winnerScore = score
    }
  }
  return Math.max(1, Math.min(events.length - 2, winner))
}

function buildPhraseContexts(
  recipe: LinearScoreRecipe,
  tracksById: ReadonlyMap<string, LinearScoreTrack>,
  indicesByTrack: ReadonlyMap<string, number[]>,
) {
  const result = new Map<number, PerformancePhraseContext>()
  const restsByTrack = new Map<string, ScoreRestV2[]>()
  if (recipe.version === 2) {
    for (const rest of recipe.plan.rests) {
      const rests = restsByTrack.get(rest.trackId) ?? []
      rests.push(rest)
      restsByTrack.set(rest.trackId, rests)
    }
  }
  for (const [trackId, indices] of indicesByTrack) {
    const track = tracksById.get(trackId)
    if (!track) continue
    const rests = restsByTrack.get(trackId) ?? []
    const phrases: number[][] = []
    let phrase: number[] = []
    let phraseStartSeconds = 0
    for (const eventIndex of indices) {
      const event = recipe.plan.events[eventIndex]
      const previousIndex = phrase.at(-1)
      const previous = previousIndex === undefined ? null : recipe.plan.events[previousIndex]
      const currentStart = eventStartSeconds(recipe, event)
      const beatSeconds = sectionBeatSeconds(recipe, event)
      const barSeconds = beatSeconds * recipe.plan.meter.numerator * (4 / recipe.plan.meter.denominator)
      const maximumPhraseSeconds = Math.max(4, Math.min(14, barSeconds * 4))
      const previousEnd = previous ? eventStartSeconds(recipe, previous) + eventDurationSeconds(recipe, previous) : Number.NEGATIVE_INFINITY
      const gap = currentStart - previousEnd
      const sectionChanged = Boolean(previous && "sectionId" in previous && "sectionId" in event && previous.sectionId !== event.sectionId)
      const gapBreak = Boolean(previous && gap >= Math.max(0.09, Math.min(0.24, beatSeconds * 0.24)))
      const boundedPhraseBreak = Boolean(previous && phrase.length >= 2 && currentStart - phraseStartSeconds >= maximumPhraseSeconds && metricEmphasisFor(recipe, event) === "primary")
      const shouldBreak = !previous || sectionChanged || gapBreak || explicitRestBreaksPhrase(recipe, previous, event, rests) || boundedPhraseBreak
      if (shouldBreak && phrase.length) {
        phrases.push(phrase)
        phrase = []
      }
      if (!phrase.length) phraseStartSeconds = currentStart
      phrase.push(eventIndex)
    }
    if (phrase.length) phrases.push(phrase)

    phrases.forEach((phraseIndices, phraseIndex) => {
      const climaxPosition = phraseClimaxPosition(recipe, phraseIndices, track)
      phraseIndices.forEach((eventIndex, position) => {
        result.set(eventIndex, {
          phraseIndex,
          position,
          length: phraseIndices.length,
          climaxPosition,
          metricEmphasis: metricEmphasisFor(recipe, recipe.plan.events[eventIndex]),
        })
      })
    })
  }
  return result
}

/** One renderer-neutral transformation used by realtime, MIDI/WAV, native samples
 * and orchestral synthesis. Articulation-specific duration and gain remain the
 * responsibility of the renderer because they describe the selected source. */
export function performedEventValues(
  recipe: LinearScoreRecipe,
  event: ScoreEvent,
  decision?: Pick<PerformanceEventDecision, "startOffsetSeconds" | "durationScale" | "velocityScale">,
): PerformedEventValues {
  return {
    startSeconds: Math.max(0, eventStartSeconds(recipe, event) + (decision?.startOffsetSeconds ?? 0)),
    durationSeconds: Math.max(0.01, eventDurationSeconds(recipe, event) * (decision?.durationScale ?? 1)),
    velocity: Math.max(0.01, Math.min(1, event.velocity * (decision?.velocityScale ?? 1))),
  }
}

export function performedV2Event(
  recipe: LinearScoreRecipeV2,
  event: LinearScoreRecipeV2["plan"]["events"][number],
  decision?: PerformanceEventDecision,
) {
  const performed = performedEventValues(recipe, event, decision)
  return {
    ...event,
    timeSeconds: performed.startSeconds,
    durationSeconds: performed.durationSeconds,
    velocity: performed.velocity,
  }
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

function eventIdentity(recipe: LinearScoreRecipe, event: LinearScoreRecipe["plan"]["events"][number], trackOrdinal: number) {
  const articulation = "articulation" in event ? event.articulation : "normal"
  const time = "timeSeconds" in event ? event.timeSeconds : event.timeBeats
  return `${recipe.plan.seed}:${event.trackId}:${trackOrdinal}:${time}:${event.notes.join(",")}:${articulation}`
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
  const phraseContexts = buildPhraseContexts(recipe, tracksById, indicesByTrack)

  for (let eventIndex = 0; eventIndex < recipe.plan.events.length; eventIndex += 1) {
    const event = recipe.plan.events[eventIndex]
    const track = tracksById.get(event.trackId)
    if (!track) continue
    const articulation = ("articulation" in event ? event.articulation : "normal") as TloqueArticulation
    const resolved = resolvePerformanceRoute(track, articulation, manifests)
    const ordinal = ordinalByTrack.get(track.id) ?? 0
    ordinalByTrack.set(track.id, ordinal + 1)
    const identity = eventIdentity(recipe, event, ordinal)
    const startSeconds = eventStartSeconds(recipe, event)
    const durationSeconds = eventDurationSeconds(recipe, event)
    const previous = previousByTrack.get(track.id)
    const phrase = phraseContexts.get(eventIndex) ?? {
      phraseIndex: 0,
      position: 0,
      length: 1,
      climaxPosition: 0,
      metricEmphasis: metricEmphasisFor(recipe, event),
    }
    const authoredGap = previous ? startSeconds - previous.endSeconds : Number.POSITIVE_INFINITY
    const connected = Boolean(
      resolved.route?.articulation === articulation
      && resolved.route?.trueLegato
      && previous
      && phrase.position > 0
      && previous.notes.length === 1
      && event.notes.length === 1
      && previous.notes[0] !== event.notes[0]
      && Math.abs(previous.notes[0] - event.notes[0]) <= 12
      && authoredGap >= -0.12
      && authoredGap <= 0.08,
    )
    const performed = familyPerformanceHumanization(semanticInstrumentId(track), humanize, identity, articulation, ordinal)
    const neighbour = neighbours.get(eventIndex)
    const director = directPerformanceEvent(recipe, {
      track,
      event,
      previous: neighbour?.previous === null || neighbour?.previous === undefined ? null : recipe.plan.events[neighbour.previous],
      next: neighbour?.next === null || neighbour?.next === undefined ? null : recipe.plan.events[neighbour.next],
      articulation,
      phrase,
    })
    // Compatibility contract: humanize=0 remains exactly neutral. Once enabled, the
    // Director gets a useful but bounded strength even at restrained musical values.
    const directorStrength = humanize <= 0 ? 0 : Math.min(1, 0.45 + humanize * 1.5)
    const directedStart = director.startOffsetSeconds * directorStrength
    const directedDuration = 1 + (director.durationScale - 1) * directorStrength
    const directedVelocity = 1 + (director.velocityScale - 1) * directorStrength
    const startOffsetSeconds = Math.max(-0.04, Math.min(0.04, performed.startOffsetSeconds + directedStart))
    const durationScale = Math.max(0.84, Math.min(1.10, performed.durationScale * directedDuration))
    const velocityScale = Math.max(0.86, Math.min(1.14, performed.velocityScale * directedVelocity))
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
      phraseIndex: phrase.phraseIndex,
      phrasePosition: phrase.position,
      phraseLength: phrase.length,
      phraseProgress: director.phraseProgress,
      phraseClimaxPosition: phrase.climaxPosition,
      metricEmphasis: phrase.metricEmphasis,
      directorReasons: director.reason,
      identity,
    })
    previousByTrack.set(track.id, { notes: event.notes, endSeconds: startSeconds + durationSeconds })
  }

  const routing = buildPerformanceRoutingPlan(playableTracks, recipe.plan.events, manifests, maxChannels)
  const decisionByIndex = new Map(decisions.map(decision => [decision.eventIndex, decision]))
  return {
    ...routing,
    directorVersion: UNIVERSAL_PERFORMANCE_DIRECTOR_VERSION,
    events: decisions,
    channelForEventIndex: eventIndex => {
      const decision = decisionByIndex.get(eventIndex)
      return decision ? routing.channelForEvent(decision.trackId, decision.articulation) : undefined
    },
    decisionForEvent: eventIndex => decisionByIndex.get(eventIndex),
  }
}

export function buildPerformedRecipeV2(
  recipe: LinearScoreRecipeV2,
  manifests: readonly InstrumentManifest[] = [],
) {
  const performance = buildPerformancePlan(recipe, manifests)
  const events = recipe.plan.events.map((event, eventIndex) =>
    performedV2Event(recipe, event, performance.decisionForEvent(eventIndex)),
  )
  return {
    performance,
    recipe: {
      ...recipe,
      plan: { ...recipe.plan, events },
    } satisfies LinearScoreRecipeV2,
  }
}
