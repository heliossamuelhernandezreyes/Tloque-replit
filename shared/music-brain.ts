import { z } from "zod"
import type { AdvancedDirectionProjectV2, DirectionVoiceNoteV2 } from "./direction"
import type { ExperienceProfileV1, NarrativeMood } from "./narrative"

export const MUSIC_BRAIN_SCORE_VERSION = 1 as const
export const MUSIC_BRAIN_PLAN_VERSION = 1 as const
export const MUSIC_BRAIN_TIMELINE_VERSION = 1 as const
export const MUSIC_BRAIN_RULE_VERSION = "tloque-music-brain-2026-08-v1.1" as const
export const MUSIC_BRAIN_KNOWLEDGE_VERSION = "tloque-music-knowledge-2026-08-v1" as const
export const MUSIC_BRAIN_CONTENT_MODE = "instrumental_only" as const

const unitSchema = z.number().finite().min(0).max(1)
const readingIntensitySchema = z.number().finite().min(0).max(0.65)
const identifierSchema = z.string().trim().min(1).max(100)
const modeSchema = z.enum(["major", "minor", "dorian", "pentatonic"])
const textureSchema = z.enum(["minimal", "open", "warm", "dark", "suspended", "rhythmic", "dense"])
const emotionSchema = z.enum([
  "neutral", "calm", "warm", "joy", "tenderness", "wonder", "sadness",
  "grief", "fear", "anger", "tension", "urgency",
])

export const musicBrainLeitmotifSchema = z.object({
  characterId: identifierSchema,
  signature: z.string().regex(/^[a-z0-9]+$/),
  intervals: z.array(z.number().int().min(-12).max(12)).min(3).max(5),
  rhythmBeats: z.array(z.number().finite().positive().max(4)).min(3).max(5),
}).strict().superRefine((motif, ctx) => {
  if (motif.intervals.length !== motif.rhythmBeats.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rhythmBeats"], message: "El ritmo debe corresponder a los intervalos" })
  }
})

export const musicBrainRegionIntentSchema = z.object({
  id: identifierSchema,
  startParagraph: z.number().int().min(0),
  endParagraph: z.number().int().min(0),
  mood: z.enum([
    "neutral", "calm", "wonder", "melancholy", "rising_tension",
    "confrontation", "climax", "release", "silence",
  ]),
  emotion: emotionSchema,
  valence: z.number().finite().min(-1).max(1),
  arousal: unitSchema,
  tension: unitSchema,
  warmth: unitSchema,
  density: unitSchema,
  intensity: readingIntensitySchema,
  texture: textureSchema,
  percussion: z.enum(["none", "subtle", "gradual"]),
  silence: z.boolean(),
  pauseBeforeMs: z.number().int().min(0).max(5_000),
  pauseAfterMs: z.number().int().min(0).max(5_000),
  transitionSeconds: z.number().finite().min(0.25).max(30),
  characterIds: z.array(identifierSchema).max(12),
  layerTags: z.array(z.string().trim().min(1).max(80)).max(12),
}).strict().superRefine((region, ctx) => {
  if (region.endParagraph < region.startParagraph) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endParagraph"], message: "La región musical termina antes de comenzar" })
  }
})

export const musicBrainScoreSchema = z.object({
  version: z.literal(MUSIC_BRAIN_SCORE_VERSION),
  ruleVersion: z.literal(MUSIC_BRAIN_RULE_VERSION),
  knowledgeVersion: z.literal(MUSIC_BRAIN_KNOWLEDGE_VERSION),
  contentMode: z.literal(MUSIC_BRAIN_CONTENT_MODE),
  bookId: z.number().int().positive(),
  chapterIndex: z.number().int().min(0),
  sourceRevision: z.number().int().min(1),
  seed: z.number().int().min(0).max(2_147_483_647),
  directionStyle: z.enum(["subtle", "narrative", "cinematic"]),
  rootMidi: z.number().int().min(36).max(60),
  preferredMode: modeSchema.nullable(),
  preferredBpm: z.number().int().min(40).max(96).nullable(),
  brightness: unitSchema,
  movement: unitSchema,
  leitmotifs: z.array(musicBrainLeitmotifSchema).max(100),
  regions: z.array(musicBrainRegionIntentSchema).min(1).max(120),
}).strict()

export type MusicBrainLeitmotifV1 = z.infer<typeof musicBrainLeitmotifSchema>
export type MusicBrainRegionIntentV1 = z.infer<typeof musicBrainRegionIntentSchema>
export type MusicBrainScoreV1 = z.infer<typeof musicBrainScoreSchema>

export const musicBrainDwellPhaseSchema = z.object({
  id: z.enum(["establish", "vary", "fragment", "ambient"]),
  startsAtCycle: z.number().int().min(0).max(64),
  variationPeriod: z.number().int().min(1).max(8),
  foundationStride: z.number().int().min(0).max(4),
  motionStride: z.number().int().min(0).max(8),
  leitmotifStride: z.number().int().min(0).max(8),
  velocityScale: z.number().finite().min(0.4).max(1),
  motionTransposeSemitones: z.number().int().min(-12).max(12),
}).strict()

export type MusicBrainDwellPhaseV1 = z.infer<typeof musicBrainDwellPhaseSchema>

export const musicBrainRegionPlanSchema = z.object({
  regionId: identifierSchema,
  startBeat: z.number().finite().min(0),
  durationBeats: z.number().finite().positive(),
  musicStartBeat: z.number().finite().min(0),
  musicEndBeat: z.number().finite().min(0),
  bpm: z.number().int().min(40).max(96),
  meter: z.tuple([z.number().int().min(2).max(7), z.literal(4)]),
  mode: modeSchema,
  progressionDegrees: z.array(z.number().int().min(0).max(6)).min(2).max(8),
  harmonicRhythmBeats: z.number().finite().min(2).max(8),
  texture: textureSchema,
  instruments: z.object({
    foundation: z.enum(["air_pad", "warm_pad", "dark_pad"]),
    motion: z.enum(["felt_keys", "soft_bell", "muted_pluck"]),
    motif: z.enum(["felt_keys", "soft_bell"]),
  }).strict(),
  intensity: readingIntensitySchema,
  density: z.number().finite().min(0).max(0.62),
  maxPolyphony: z.number().int().min(0).max(6),
  silence: z.boolean(),
  characterIds: z.array(identifierSchema).max(12),
  dwellPhases: z.array(musicBrainDwellPhaseSchema).length(4),
}).strict().superRefine((region, ctx) => {
  if (region.musicEndBeat < region.musicStartBeat) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["musicEndBeat"], message: "La música termina antes de comenzar" })
  }
  if (region.dwellPhases[0]?.startsAtCycle !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dwellPhases", 0, "startsAtCycle"], message: "La evolución debe comenzar en el ciclo cero" })
  }
  for (let index = 1; index < region.dwellPhases.length; index += 1) {
    if (region.dwellPhases[index].startsAtCycle <= region.dwellPhases[index - 1].startsAtCycle) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dwellPhases", index, "startsAtCycle"], message: "Las fases deben avanzar en orden" })
    }
  }
})

export const musicBrainCompositionPlanSchema = z.object({
  version: z.literal(MUSIC_BRAIN_PLAN_VERSION),
  scoreVersion: z.literal(MUSIC_BRAIN_SCORE_VERSION),
  ruleVersion: z.literal(MUSIC_BRAIN_RULE_VERSION),
  knowledgeVersion: z.literal(MUSIC_BRAIN_KNOWLEDGE_VERSION),
  contentMode: z.literal(MUSIC_BRAIN_CONTENT_MODE),
  seed: z.number().int().min(0).max(2_147_483_647),
  rootMidi: z.number().int().min(36).max(60),
  regions: z.array(musicBrainRegionPlanSchema).min(1).max(120),
  totalBeats: z.number().finite().positive(),
}).strict()

const eventBaseSchema = z.object({
  id: z.string().trim().min(1).max(180),
  regionId: identifierSchema,
  beat: z.number().finite().min(0),
})

export const musicBrainNoteEventSchema = eventBaseSchema.extend({
  kind: z.literal("note"),
  durationBeats: z.number().finite().positive().max(16),
  midi: z.number().int().min(24).max(96),
  velocity: z.number().finite().min(0.04).max(0.42),
  voice: z.enum(["foundation", "motion", "leitmotif"]),
  characterId: identifierSchema.nullable(),
}).strict()

export const musicBrainMarkerEventSchema = eventBaseSchema.extend({
  kind: z.literal("marker"),
  marker: z.enum(["region_start", "region_end", "silence_start", "silence_end"]),
  durationBeats: z.number().finite().min(0).max(128),
}).strict()

export const musicBrainTempoEventSchema = eventBaseSchema.extend({
  kind: z.literal("tempo"),
  bpm: z.number().int().min(40).max(96),
}).strict()

export const musicBrainEventSchema = z.discriminatedUnion("kind", [
  musicBrainNoteEventSchema,
  musicBrainMarkerEventSchema,
  musicBrainTempoEventSchema,
])

export const musicBrainTimelineSchema = z.object({
  version: z.literal(MUSIC_BRAIN_TIMELINE_VERSION),
  planVersion: z.literal(MUSIC_BRAIN_PLAN_VERSION),
  ruleVersion: z.literal(MUSIC_BRAIN_RULE_VERSION),
  contentMode: z.literal(MUSIC_BRAIN_CONTENT_MODE),
  seed: z.number().int().min(0).max(2_147_483_647),
  totalBeats: z.number().finite().positive(),
  events: z.array(musicBrainEventSchema).max(20_000),
}).strict()

export type MusicBrainRegionPlanV1 = z.infer<typeof musicBrainRegionPlanSchema>
export type MusicBrainCompositionPlanV1 = z.infer<typeof musicBrainCompositionPlanSchema>
export type MusicBrainEventV1 = z.infer<typeof musicBrainEventSchema>
export type MusicBrainNoteEventV1 = z.infer<typeof musicBrainNoteEventSchema>
export type MusicBrainTimelineV1 = z.infer<typeof musicBrainTimelineSchema>

export interface MusicBrainCompilationV1 {
  plan: MusicBrainCompositionPlanV1
  timeline: MusicBrainTimelineV1
}

interface LegacyProceduralRecipe {
  version?: 1
  rootMidi: number
  scale: "major" | "minor" | "dorian" | "pentatonic"
  bpm: number
  bars: number
  density: number
  brightness: number
  movement: number
  seed: number
  preset: "quiet_observatory" | "warm_memory" | "cold_suspense" | "deep_focus"
}

const AROUSAL_BY_EMOTION: Record<MusicBrainRegionIntentV1["emotion"], number> = {
  neutral: 0.25, calm: 0.12, warm: 0.25, joy: 0.55, tenderness: 0.18, wonder: 0.4,
  sadness: 0.22, grief: 0.38, fear: 0.72, anger: 0.78, tension: 0.68, urgency: 0.85,
}

const VALENCE_BY_EMOTION: Record<MusicBrainRegionIntentV1["emotion"], number> = {
  neutral: 0, calm: 0.3, warm: 0.55, joy: 0.8, tenderness: 0.65, wonder: 0.5,
  sadness: -0.55, grief: -0.8, fear: -0.65, anger: -0.55, tension: -0.3, urgency: -0.1,
}

const EMOTION_BY_MOOD: Record<NarrativeMood, MusicBrainRegionIntentV1["emotion"]> = {
  neutral: "neutral", calm: "calm", wonder: "wonder", melancholy: "sadness",
  rising_tension: "tension", confrontation: "anger", climax: "urgency",
  release: "warm", silence: "neutral",
}

const SCALE_INTERVALS: Record<MusicBrainScoreV1["preferredMode"] extends infer _T ? Exclude<MusicBrainScoreV1["preferredMode"], null> : never, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10],
}

const PROGRESSIONS: Record<Exclude<MusicBrainScoreV1["preferredMode"], null>, readonly number[][]> = {
  major: [[0, 4, 5, 3], [0, 3, 1, 4], [0, 5, 3, 4]],
  minor: [[0, 5, 3, 4], [0, 3, 6, 4], [0, 1, 5, 4]],
  dorian: [[0, 3, 6, 4], [0, 1, 3, 0], [0, 5, 3, 6]],
  pentatonic: [[0, 3, 4, 2], [0, 4, 3, 0], [0, 2, 3, 4]],
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function stableMusicBrainHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function dwellPhasesFor(score: MusicBrainScoreV1, region: MusicBrainRegionIntentV1): MusicBrainDwellPhaseV1[] {
  const lowerMotion = deterministicUnit(score.seed, `${region.id}:dwell:register`) > 0.5 ? -12 : 0
  return z.array(musicBrainDwellPhaseSchema).length(4).parse([
    { id: "establish", startsAtCycle: 0, variationPeriod: 1, foundationStride: 1, motionStride: 1, leitmotifStride: 1, velocityScale: 1, motionTransposeSemitones: 0 },
    { id: "vary", startsAtCycle: 1, variationPeriod: 1, foundationStride: 1, motionStride: 2, leitmotifStride: 1, velocityScale: 0.94, motionTransposeSemitones: lowerMotion },
    { id: "fragment", startsAtCycle: 2, variationPeriod: 2, foundationStride: 1, motionStride: 3, leitmotifStride: 2, velocityScale: 0.82, motionTransposeSemitones: 0 },
    { id: "ambient", startsAtCycle: 4, variationPeriod: 4, foundationStride: region.texture === "minimal" ? 1 : 2, motionStride: 0, leitmotifStride: 0, velocityScale: 0.68, motionTransposeSemitones: 0 },
  ])
}

export function musicBrainDwellPhaseForCycle(region: MusicBrainRegionPlanV1, cycle: number): MusicBrainDwellPhaseV1 {
  const safeCycle = Math.max(0, Math.floor(cycle))
  return [...region.dwellPhases]
    .reverse()
    .find(phase => safeCycle >= phase.startsAtCycle) ?? region.dwellPhases[0]
}

export function musicBrainNoteForDwellCycle(
  event: MusicBrainNoteEventV1,
  phase: MusicBrainDwellPhaseV1,
  cycle: number,
): MusicBrainNoteEventV1 | null {
  const stride = event.voice === "foundation" ? phase.foundationStride
    : event.voice === "motion" ? phase.motionStride : phase.leitmotifStride
  if (stride === 0) return null
  const variation = Math.max(0, Math.floor(cycle) - phase.startsAtCycle) % phase.variationPeriod
  if (stride > 1 && stableMusicBrainHash(`${phase.id}:${variation}:${event.id}`) % stride !== 0) return null
  const transpose = event.voice === "motion" ? phase.motionTransposeSemitones : 0
  return musicBrainNoteEventSchema.parse({
    ...event,
    midi: clamp(event.midi + transpose, 24, 96),
    velocity: clamp(event.velocity * phase.velocityScale, 0.04, 0.42),
  })
}

function deterministicUnit(seed: number, salt: string): number {
  let value = (seed ^ stableMusicBrainHash(salt)) >>> 0
  value += 0x6d2b79f5
  value = Math.imul(value ^ value >>> 15, value | 1)
  value ^= value + Math.imul(value ^ value >>> 7, value | 61)
  return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
}

export function defaultMusicBrainSeed(bookId: number, chapterIndex: number, revision: number): number {
  return stableMusicBrainHash(`${bookId}:${chapterIndex}:${revision}`) & 0x7fffffff
}

export function leitmotifForCharacter(characterId: string, seed: number): MusicBrainLeitmotifV1 {
  const hash = stableMusicBrainHash(`${seed}:${characterId}`)
  const intervalSets = [
    [0, 2, 7, 5], [0, 3, 7, 10], [0, 5, 2, 7], [0, 7, 4, 2],
    [0, -2, 3, 7], [0, 4, 2, 9], [0, 3, -2, 5], [0, 5, 7, 3],
  ] as const
  const rhythms = [
    [1, 0.5, 0.5, 2], [0.5, 0.5, 1, 2], [1.5, 0.5, 1, 1], [0.5, 1, 0.5, 2],
  ] as const
  return musicBrainLeitmotifSchema.parse({
    characterId,
    signature: hash.toString(36),
    intervals: intervalSets[hash % intervalSets.length],
    rhythmBeats: rhythms[(hash >>> 4) % rhythms.length],
  })
}

function dominantEmotion(notes: DirectionVoiceNoteV2[]): MusicBrainRegionIntentV1["emotion"] {
  const weights = new Map<MusicBrainRegionIntentV1["emotion"], number>()
  for (const note of notes) weights.set(note.emotion, (weights.get(note.emotion) ?? 0) + 0.25 + note.intensity)
  return [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "neutral"
}

function regionIntent(input: {
  id: string
  startParagraph: number
  endParagraph: number
  mood: NarrativeMood
  tension: number
  warmth: number
  density: number
  targetIntensity: number
  texture: MusicBrainRegionIntentV1["texture"]
  percussion: MusicBrainRegionIntentV1["percussion"]
  transitionSeconds: number
  layerTags: string[]
  notes?: DirectionVoiceNoteV2[]
  pauseBeforeMs?: number
  pauseAfterMs?: number
  characterIds?: string[]
}): MusicBrainRegionIntentV1 {
  const emotion = input.notes?.length ? dominantEmotion(input.notes) : EMOTION_BY_MOOD[input.mood]
  const arousal = clamp(AROUSAL_BY_EMOTION[emotion] * 0.55 + input.tension * 0.3 + input.density * 0.15, 0, 1)
  const valence = clamp(VALENCE_BY_EMOTION[emotion] * 0.7 + (input.warmth - 0.5) * 0.6, -1, 1)
  return musicBrainRegionIntentSchema.parse({
    id: input.id,
    startParagraph: input.startParagraph,
    endParagraph: input.endParagraph,
    mood: input.mood,
    emotion,
    valence,
    arousal,
    tension: input.tension,
    warmth: input.warmth,
    density: input.density,
    intensity: clamp(input.targetIntensity, 0, 0.65),
    texture: input.texture,
    percussion: input.percussion,
    silence: input.mood === "silence",
    pauseBeforeMs: input.pauseBeforeMs ?? 0,
    pauseAfterMs: input.pauseAfterMs ?? 0,
    transitionSeconds: input.transitionSeconds,
    characterIds: [...new Set(input.characterIds ?? [])].sort().slice(0, 12),
    layerTags: [...new Set(input.layerTags)].sort().slice(0, 12),
  })
}

export function musicBrainScoreForDirection(
  project: AdvancedDirectionProjectV2,
  seed = defaultMusicBrainSeed(project.bookId, project.chapterIndex, project.revision),
): MusicBrainScoreV1 {
  const noteBySpan = new Map(project.voiceNotes.map(note => [note.spanId, note]))
  const orderedCharacters = [...project.voiceProject.characters].sort((a, b) => a.id.localeCompare(b.id))
  const regions = [...project.musicProject.regions]
    .sort((a, b) => a.startParagraph - b.startParagraph || a.id.localeCompare(b.id))
    .map(region => {
      const spans = project.voiceProject.spans.filter(span =>
        span.paragraphIndex >= region.startParagraph && span.paragraphIndex <= region.endParagraph,
      )
      const notes = spans.map(span => noteBySpan.get(span.id)).filter((note): note is DirectionVoiceNoteV2 => Boolean(note))
      return regionIntent({
        id: region.id,
        startParagraph: region.startParagraph,
        endParagraph: region.endParagraph,
        mood: region.mood,
        tension: region.tension,
        warmth: region.warmth,
        density: region.density,
        targetIntensity: region.targetIntensity,
        texture: region.texture,
        percussion: region.percussion,
        transitionSeconds: region.transition.preferredSeconds,
        layerTags: region.layerTags,
        notes,
        pauseBeforeMs: Math.max(0, ...spans.map(span => span.pauseBeforeMs)),
        pauseAfterMs: Math.max(0, ...spans.map(span => span.pauseAfterMs)),
        characterIds: spans.filter(span => span.kind === "dialogue").map(span => span.speakerId),
      })
    })
  return musicBrainScoreSchema.parse({
    version: MUSIC_BRAIN_SCORE_VERSION,
    ruleVersion: MUSIC_BRAIN_RULE_VERSION,
    knowledgeVersion: MUSIC_BRAIN_KNOWLEDGE_VERSION,
    contentMode: MUSIC_BRAIN_CONTENT_MODE,
    bookId: project.bookId,
    chapterIndex: project.chapterIndex,
    sourceRevision: project.revision,
    seed,
    directionStyle: project.musicProject.directionStyle,
    rootMidi: 42 + stableMusicBrainHash(`${project.bookId}:${project.chapterIndex}`) % 12,
    preferredMode: null,
    preferredBpm: null,
    brightness: 0.42,
    movement: 0.3,
    leitmotifs: orderedCharacters.map(character => leitmotifForCharacter(character.id, seed)),
    regions,
  })
}

export function musicBrainScoreForExperience(
  profile: ExperienceProfileV1,
  seed = defaultMusicBrainSeed(profile.bookId, profile.chapterIndex, profile.revision),
): MusicBrainScoreV1 {
  const regions = profile.regions.map(region => regionIntent({
    id: region.id,
    startParagraph: Math.round(region.startProgress * Math.max(0, profile.paragraphCount - 1)),
    endParagraph: Math.round(region.endProgress * Math.max(0, profile.paragraphCount - 1)),
    mood: region.mood,
    tension: region.tension,
    warmth: region.warmth,
    density: region.density,
    targetIntensity: region.targetIntensity,
    texture: region.texture,
    percussion: region.percussion,
    transitionSeconds: region.transition.preferredSeconds,
    layerTags: region.layerTags,
  }))
  return musicBrainScoreSchema.parse({
    version: MUSIC_BRAIN_SCORE_VERSION,
    ruleVersion: MUSIC_BRAIN_RULE_VERSION,
    knowledgeVersion: MUSIC_BRAIN_KNOWLEDGE_VERSION,
    contentMode: MUSIC_BRAIN_CONTENT_MODE,
    bookId: profile.bookId,
    chapterIndex: profile.chapterIndex,
    sourceRevision: profile.revision,
    seed,
    directionStyle: profile.directionStyle,
    rootMidi: 42 + stableMusicBrainHash(`${profile.bookId}:${profile.chapterIndex}`) % 12,
    preferredMode: null,
    preferredBpm: null,
    brightness: 0.42,
    movement: 0.3,
    leitmotifs: [],
    regions,
  })
}

export function musicBrainScoreForProceduralRecipe(recipe: LegacyProceduralRecipe): MusicBrainScoreV1 {
  const emotion: MusicBrainRegionIntentV1["emotion"] = recipe.preset === "warm_memory" ? "warm"
    : recipe.preset === "cold_suspense" ? "tension"
      : recipe.preset === "deep_focus" ? "calm" : "wonder"
  const mood: NarrativeMood = recipe.preset === "cold_suspense" ? "rising_tension"
    : recipe.preset === "warm_memory" ? "melancholy"
      : recipe.preset === "deep_focus" ? "calm" : "wonder"
  const region = regionIntent({
    id: "legacy-cue",
    startParagraph: 0,
    endParagraph: Math.max(1, recipe.bars - 1),
    mood,
    tension: recipe.preset === "cold_suspense" ? 0.68 : 0.2,
    warmth: recipe.preset === "warm_memory" ? 0.75 : 0.45,
    density: recipe.density,
    targetIntensity: 0.2 + recipe.density * 0.35,
    texture: recipe.preset === "deep_focus" ? "minimal" : recipe.preset === "cold_suspense" ? "suspended" : "open",
    percussion: "none",
    transitionSeconds: 6,
    layerTags: [recipe.preset],
    notes: [{ emotion, intensity: recipe.density } as DirectionVoiceNoteV2],
  })
  return musicBrainScoreSchema.parse({
    version: MUSIC_BRAIN_SCORE_VERSION,
    ruleVersion: MUSIC_BRAIN_RULE_VERSION,
    knowledgeVersion: MUSIC_BRAIN_KNOWLEDGE_VERSION,
    contentMode: MUSIC_BRAIN_CONTENT_MODE,
    bookId: 1,
    chapterIndex: 0,
    sourceRevision: 1,
    seed: recipe.seed,
    directionStyle: "subtle",
    rootMidi: recipe.rootMidi,
    preferredMode: recipe.scale,
    preferredBpm: clamp(recipe.bpm, 40, 96),
    brightness: recipe.brightness,
    movement: recipe.movement,
    leitmotifs: [],
    regions: [region],
  })
}

function modeFor(score: MusicBrainScoreV1, region: MusicBrainRegionIntentV1): Exclude<MusicBrainScoreV1["preferredMode"], null> {
  if (score.preferredMode) return score.preferredMode
  const ambiguity = region.tension * 0.5 + region.arousal * 0.25 + (1 - region.warmth) * 0.25
  if (ambiguity > 0.66) return deterministicUnit(score.seed, `${region.id}:mode`) > 0.48 ? "dorian" : "minor"
  if (region.valence > 0.35 && region.warmth > 0.55) return deterministicUnit(score.seed, `${region.id}:mode`) > 0.35 ? "major" : "pentatonic"
  return deterministicUnit(score.seed, `${region.id}:mode`) > 0.5 ? "dorian" : "pentatonic"
}

function instrumentsFor(region: MusicBrainRegionIntentV1): MusicBrainRegionPlanV1["instruments"] {
  const foundation = region.texture === "dark" || region.tension > 0.65 ? "dark_pad"
    : region.warmth > 0.58 ? "warm_pad" : "air_pad"
  const motion = region.texture === "rhythmic" ? "muted_pluck"
    : region.warmth > 0.55 ? "felt_keys" : "soft_bell"
  return { foundation, motion, motif: region.warmth > 0.5 ? "felt_keys" : "soft_bell" }
}

function progressionFor(mode: Exclude<MusicBrainScoreV1["preferredMode"], null>, seed: number, regionId: string): number[] {
  const choices = PROGRESSIONS[mode]
  return [...choices[Math.floor(deterministicUnit(seed, `${regionId}:progression`) * choices.length) % choices.length]]
}

function barsFor(region: MusicBrainRegionIntentV1): number {
  const paragraphSpan = region.endParagraph - region.startParagraph + 1
  return Math.round(clamp(2 + Math.ceil(paragraphSpan / 2) + region.density * 2, 2, 8))
}

function chooseVoicing(base: number[], previous: number[] | null): number[] {
  const options: number[][] = []
  for (const a of [-12, 0, 12]) for (const b of [-12, 0, 12]) for (const c of [-12, 0, 12]) {
    const candidate = [base[0] + a, base[1] + b, base[2] + c].sort((left, right) => left - right)
    if (candidate[0] >= 36 && candidate[2] <= 78 && new Set(candidate).size === 3) options.push(candidate)
  }
  const target = previous ?? [48, 55, 60]
  return options.sort((left, right) => {
    const cost = (notes: number[]) => notes.reduce((sum, note, index) => sum + Math.abs(note - target[index]), 0) + (notes[2] - notes[0]) * 0.08
    return cost(left) - cost(right) || left.join(",").localeCompare(right.join(","))
  })[0] ?? base
}

function chordFor(rootMidi: number, scale: readonly number[], degree: number, previous: number[] | null): number[] {
  const noteAt = (offset: number) => rootMidi + scale[(degree + offset) % scale.length] + Math.floor((degree + offset) / scale.length) * 12
  return chooseVoicing([noteAt(0), noteAt(2), noteAt(4)], previous)
}

function eventOrder(event: MusicBrainEventV1): number {
  if (event.kind === "tempo") return 0
  if (event.kind === "marker") return event.marker.endsWith("start") ? 1 : 3
  return 2
}

export function compileMusicBrainScore(input: MusicBrainScoreV1): MusicBrainCompilationV1 {
  const score = musicBrainScoreSchema.parse(input)
  const styleCap = { subtle: 0.48, narrative: 0.58, cinematic: 0.65 }[score.directionStyle]
  const motifs = new Map(score.leitmotifs.map(motif => [motif.characterId, motif]))
  const plans: MusicBrainRegionPlanV1[] = []
  const events: MusicBrainEventV1[] = []
  let cursor = 0

  for (const region of [...score.regions].sort((a, b) => a.startParagraph - b.startParagraph || a.id.localeCompare(b.id))) {
    const mode = modeFor(score, region)
    const bpm = score.preferredBpm ?? Math.round(clamp(50 + region.arousal * 22 + region.density * 8, 44, 88))
    const beatMs = 60_000 / bpm
    const pauseBeforeBeats = clamp(region.pauseBeforeMs / beatMs, 0, 4)
    const pauseAfterBeats = clamp(region.pauseAfterMs / beatMs, 0, 4)
    const meter: [number, 4] = region.texture === "suspended" && deterministicUnit(score.seed, `${region.id}:meter`) > 0.62 ? [3, 4] : [4, 4]
    const barBeats = meter[0]
    const musicBeats = barsFor(region) * barBeats
    const musicStartBeat = cursor + pauseBeforeBeats
    const musicEndBeat = musicStartBeat + musicBeats
    const durationBeats = pauseBeforeBeats + musicBeats + pauseAfterBeats
    const density = clamp(region.density * 0.55 + region.intensity * 0.25 + score.movement * 0.2, 0.08, 0.62)
    const plan = musicBrainRegionPlanSchema.parse({
      regionId: region.id,
      startBeat: cursor,
      durationBeats,
      musicStartBeat,
      musicEndBeat,
      bpm,
      meter,
      mode,
      progressionDegrees: progressionFor(mode, score.seed, region.id),
      harmonicRhythmBeats: density > 0.5 ? barBeats : barBeats * 2,
      texture: region.texture,
      instruments: instrumentsFor(region),
      intensity: clamp(region.intensity, 0, styleCap),
      density,
      maxPolyphony: region.silence ? 0 : density > 0.52 ? 6 : density > 0.28 ? 5 : 4,
      silence: region.silence,
      characterIds: region.characterIds,
      dwellPhases: dwellPhasesFor(score, region),
    })
    plans.push(plan)
    events.push({ id: `${region.id}:start`, regionId: region.id, kind: "marker", marker: "region_start", beat: cursor, durationBeats: durationBeats })
    events.push({ id: `${region.id}:tempo`, regionId: region.id, kind: "tempo", beat: musicStartBeat, bpm })

    if (region.silence) {
      events.push({ id: `${region.id}:silence:start`, regionId: region.id, kind: "marker", marker: "silence_start", beat: musicStartBeat, durationBeats: musicBeats })
      events.push({ id: `${region.id}:silence:end`, regionId: region.id, kind: "marker", marker: "silence_end", beat: musicEndBeat, durationBeats: 0 })
    } else {
      const scale = SCALE_INTERVALS[mode]
      const chordCount = Math.ceil(musicBeats / plan.harmonicRhythmBeats)
      let previousVoicing: number[] | null = null
      for (let chordIndex = 0; chordIndex < chordCount; chordIndex += 1) {
        const degree = plan.progressionDegrees[chordIndex % plan.progressionDegrees.length] % scale.length
        const voicing = chordFor(score.rootMidi, scale, degree, previousVoicing)
        previousVoicing = voicing
        const beat = musicStartBeat + chordIndex * plan.harmonicRhythmBeats
        const duration = Math.min(plan.harmonicRhythmBeats * 0.92, musicEndBeat - beat)
        for (const [voiceIndex, midi] of voicing.entries()) events.push({
          id: `${region.id}:foundation:${chordIndex}:${voiceIndex}`,
          regionId: region.id,
          kind: "note",
          beat,
          durationBeats: Math.max(0.25, duration),
          midi,
          velocity: clamp(0.1 + plan.intensity * 0.28 - voiceIndex * 0.008, 0.08, 0.31),
          voice: "foundation",
          characterId: null,
        })

        if (density >= 0.24 && chordIndex < chordCount - 1) {
          const subdivision = density > 0.48 ? 1 : 2
          for (let offset = subdivision; offset < plan.harmonicRhythmBeats; offset += subdivision) {
            if (deterministicUnit(score.seed, `${region.id}:motion:${chordIndex}:${offset}`) > density) continue
            const midi = voicing[(chordIndex + Math.round(offset)) % voicing.length] + 12
            events.push({
              id: `${region.id}:motion:${chordIndex}:${offset}`,
              regionId: region.id,
              kind: "note",
              beat: beat + offset,
              durationBeats: Math.min(0.75, subdivision * 0.65),
              midi: clamp(midi, 48, 88),
              velocity: clamp(0.07 + plan.intensity * 0.18, 0.06, 0.2),
              voice: "motion",
              characterId: null,
            })
          }
        }
      }

      for (const [characterIndex, characterId] of region.characterIds.slice(0, 2).entries()) {
        const motif = motifs.get(characterId)
        if (!motif) continue
        let beat = musicStartBeat + Math.min(barBeats * (1 + characterIndex), Math.max(0, musicBeats - barBeats))
        for (let motifIndex = 0; motifIndex < motif.intervals.length; motifIndex += 1) {
          const duration = motif.rhythmBeats[motifIndex]
          if (beat + duration > musicEndBeat) break
          events.push({
            id: `${region.id}:leitmotif:${characterId}:${motifIndex}`,
            regionId: region.id,
            kind: "note",
            beat,
            durationBeats: duration * 0.82,
            midi: clamp(score.rootMidi + 12 + motif.intervals[motifIndex], 48, 88),
            velocity: clamp(0.1 + plan.intensity * 0.2, 0.08, 0.24),
            voice: "leitmotif",
            characterId,
          })
          beat += duration
        }
      }
    }

    events.push({ id: `${region.id}:end`, regionId: region.id, kind: "marker", marker: "region_end", beat: cursor + durationBeats, durationBeats: 0 })
    cursor += durationBeats
  }

  events.sort((left, right) => left.beat - right.beat
    || eventOrder(left) - eventOrder(right)
    || (left.kind === "note" && right.kind === "note" ? left.midi - right.midi : 0)
    || left.id.localeCompare(right.id))

  const plan = musicBrainCompositionPlanSchema.parse({
    version: MUSIC_BRAIN_PLAN_VERSION,
    scoreVersion: MUSIC_BRAIN_SCORE_VERSION,
    ruleVersion: MUSIC_BRAIN_RULE_VERSION,
    knowledgeVersion: MUSIC_BRAIN_KNOWLEDGE_VERSION,
    contentMode: MUSIC_BRAIN_CONTENT_MODE,
    seed: score.seed,
    rootMidi: score.rootMidi,
    regions: plans,
    totalBeats: cursor,
  })
  const timeline = musicBrainTimelineSchema.parse({
    version: MUSIC_BRAIN_TIMELINE_VERSION,
    planVersion: MUSIC_BRAIN_PLAN_VERSION,
    ruleVersion: MUSIC_BRAIN_RULE_VERSION,
    contentMode: MUSIC_BRAIN_CONTENT_MODE,
    seed: score.seed,
    totalBeats: cursor,
    events,
  })
  return { plan, timeline }
}

export function notesForMusicBrainRegion(timeline: MusicBrainTimelineV1, regionId: string): MusicBrainNoteEventV1[] {
  return timeline.events.filter((event): event is MusicBrainNoteEventV1 => event.kind === "note" && event.regionId === regionId)
}
