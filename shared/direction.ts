import { z } from "zod"
import { paperChargeFor } from "./paper"
import {
  narrativeProjectSchema,
  type NarrativeProjectV1,
} from "./narrative"
import {
  speechProjectSchema,
  type SpeechProjectV1,
  type SpeechSpanV1,
} from "./speech"

export const ADVANCED_DIRECTION_VERSION = 2 as const
export const DIRECTION_AGENT_PROMPT_VERSION = "tloque-da-2026-08-15-v1" as const

const unitSchema = z.number().finite().min(0).max(1)
const safeTagSchema = z.string().trim().min(1).max(80)

export const directionEmotionSchema = z.enum([
  "neutral", "calm", "warm", "joy", "tenderness", "wonder", "sadness",
  "grief", "fear", "anger", "tension", "urgency",
])

export const directionProjectionSchema = z.enum([
  "whisper", "soft", "natural", "projected", "shout",
])

export const directionVocalStateSchema = z.enum([
  "none", "smiling", "trembling", "near_tears", "crying", "breathless", "laughing",
])

export const directionVoiceNoteSchema = z.object({
  spanId: z.string().trim().min(1).max(100),
  emotion: directionEmotionSchema.default("neutral"),
  projection: directionProjectionSchema.default("natural"),
  vocalState: directionVocalStateSchema.default("none"),
  intensity: unitSchema.default(0.4),
  elevenLabsTags: z.array(safeTagSchema).max(12).default([]),
  source: z.enum(["manual", "agent"]).default("manual"),
  locked: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
}).strict()

export const directionMusicNodeSchema = z.object({
  regionId: z.string().trim().min(1).max(100),
  scoreId: z.number().int().positive().nullable(),
  layerIds: z.array(z.number().int().positive()).max(24).default([]),
  entry: z.enum(["continue", "fade_in", "crossfade"]).default("crossfade"),
  exit: z.enum(["continue", "fade_out", "crossfade"]).default("crossfade"),
  crossfadeSeconds: z.number().finite().min(0.25).max(30).default(8),
  source: z.enum(["manual", "agent"]).default("manual"),
  locked: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
}).strict()

export const directionAgentAuditSchema = z.object({
  promptVersion: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(160),
  generatedAt: z.string().datetime(),
}).strict()

export const advancedDirectionProjectObjectSchema = z.object({
  version: z.literal(ADVANCED_DIRECTION_VERSION),
  bookId: z.number().int().positive(),
  chapterIndex: z.number().int().min(0),
  revision: z.number().int().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.string().trim().min(2).max(12),
  voiceProject: speechProjectSchema,
  musicProject: narrativeProjectSchema,
  voiceNotes: z.array(directionVoiceNoteSchema).max(5_000).default([]),
  musicNodes: z.array(directionMusicNodeSchema).max(500).default([]),
  agentAudit: directionAgentAuditSchema.nullable().default(null),
}).strict()

export const advancedDirectionEditableProjectSchema = advancedDirectionProjectObjectSchema.omit({
  bookId: true,
  chapterIndex: true,
  revision: true,
  contentHash: true,
})

export const advancedDirectionProjectSchema = advancedDirectionProjectObjectSchema.superRefine((project, ctx) => {
  const fixed = [project.voiceProject, project.musicProject]
  for (const [index, nested] of fixed.entries()) {
    if (nested.bookId !== project.bookId || nested.chapterIndex !== project.chapterIndex) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index === 0 ? "voiceProject" : "musicProject"], message: "La partitura apunta a otro capítulo" })
    }
    if (nested.revision !== project.revision) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index === 0 ? "voiceProject" : "musicProject", "revision"], message: "La revisión interna no coincide" })
    }
  }
  if (project.voiceProject.contentHash !== project.contentHash) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceProject", "contentHash"], message: "La voz apunta a otro manuscrito" })
  }
  if (project.voiceProject.language !== project.language) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceProject", "language"], message: "El idioma interno no coincide" })
  }
  const spanIds = new Set(project.voiceProject.spans.map(span => span.id))
  const regionIds = new Set(project.musicProject.regions.map(region => region.id))
  const seenNotes = new Set<string>()
  for (const note of project.voiceNotes) {
    if (!spanIds.has(note.spanId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceNotes"], message: `La nota ${note.spanId} no tiene fragmento` })
    if (seenNotes.has(note.spanId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceNotes"], message: `La nota ${note.spanId} está repetida` })
    seenNotes.add(note.spanId)
  }
  const seenNodes = new Set<string>()
  for (const node of project.musicNodes) {
    if (!regionIds.has(node.regionId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["musicNodes"], message: `El nodo ${node.regionId} no tiene región` })
    if (seenNodes.has(node.regionId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["musicNodes"], message: `El nodo ${node.regionId} está repetido` })
    seenNodes.add(node.regionId)
  }
})

export type DirectionVoiceNoteV2 = z.infer<typeof directionVoiceNoteSchema>
export type DirectionMusicNodeV2 = z.infer<typeof directionMusicNodeSchema>
export type AdvancedDirectionProjectV2 = z.infer<typeof advancedDirectionProjectSchema>
export type DirectionAgentMode = "replace_unlocked" | "fill_gaps"

export interface DirectionAgentQuote {
  estimatedInputUnits: number
  estimatedOutputUnits: number
  estimatedPaper: number
  maximumPaper: number
}

export function quoteDirectionAgent(contentLength: number, catalogItems: number): DirectionAgentQuote {
  const characters = Number.isFinite(contentLength) ? Math.max(0, Math.trunc(contentLength)) : 0
  const catalog = Number.isFinite(catalogItems) ? Math.max(0, Math.trunc(catalogItems)) : 0
  // El DA usa dos análisis estructurados: actuación vocal y partitura musical.
  const estimatedInputUnits = Math.max(1, Math.ceil(characters / 3) * 2 + catalog * 28)
  const estimatedOutputUnits = Math.min(16_000, Math.max(2_000, Math.ceil(characters * 0.7)))
  const estimatedPaper = paperChargeFor("oracle", estimatedInputUnits, estimatedOutputUnits)
  // Tope visible antes de ejecutar: 25 % de colchón y una unidad de redondeo.
  const maximumPaper = Math.max(estimatedPaper, Math.ceil(estimatedPaper * 1.25) + 1)
  return { estimatedInputUnits, estimatedOutputUnits, estimatedPaper, maximumPaper }
}

function spansOverlap(a: SpeechSpanV1, b: SpeechSpanV1): boolean {
  return a.paragraphIndex === b.paragraphIndex
    && a.startOffset < b.endOffset
    && b.startOffset < a.endOffset
}

function regionsOverlap(a: NarrativeProjectV1["regions"][number], b: NarrativeProjectV1["regions"][number]): boolean {
  return a.startParagraph <= b.endParagraph && b.startParagraph <= a.endParagraph
}

function subtractLockedSpans(span: SpeechSpanV1, lockedSpans: SpeechSpanV1[]): SpeechSpanV1[] {
  let pieces = [span]
  for (const locked of lockedSpans) {
    if (!spansOverlap(span, locked)) continue
    pieces = pieces.flatMap(piece => {
      if (!spansOverlap(piece, locked)) return [piece]
      const next: SpeechSpanV1[] = []
      if (piece.startOffset < locked.startOffset) next.push({ ...piece, endOffset: locked.startOffset })
      if (locked.endOffset < piece.endOffset) next.push({ ...piece, startOffset: locked.endOffset })
      return next
    })
  }
  return pieces.map((piece, index) => index === 0 ? piece : {
    ...piece,
    id: `${span.id.slice(0, 86)}-part-${index + 1}`,
  })
}

function noteFor(project: AdvancedDirectionProjectV2, spanId: string): DirectionVoiceNoteV2 | undefined {
  return project.voiceNotes.find(note => note.spanId === spanId)
}

function nodeFor(project: AdvancedDirectionProjectV2, regionId: string): DirectionMusicNodeV2 | undefined {
  return project.musicNodes.find(node => node.regionId === regionId)
}

/**
 * Une una propuesta sin permitir que el agente cambie anotaciones bloqueadas.
 * El manuscrito no forma parte de este documento y por tanto no puede mutarse.
 */
export function mergeDirectionProposal(
  current: AdvancedDirectionProjectV2 | null,
  proposedInput: AdvancedDirectionProjectV2,
  mode: DirectionAgentMode,
): AdvancedDirectionProjectV2 {
  const proposed = advancedDirectionProjectSchema.parse(proposedInput)
  if (!current) return proposed
  const existing = advancedDirectionProjectSchema.parse(current)
  if (existing.bookId !== proposed.bookId || existing.chapterIndex !== proposed.chapterIndex || existing.contentHash !== proposed.contentHash) {
    throw new Error("La propuesta y la partitura actual no corresponden al mismo manuscrito")
  }

  const lockedSpans = existing.voiceProject.spans.filter(span => span.locked)
  const keptSpans = mode === "fill_gaps" ? existing.voiceProject.spans : lockedSpans
  const originIdBySpanId = new Map<string, string>()
  const acceptedSpans = proposed.voiceProject.spans.flatMap(span => {
    if (mode === "fill_gaps") {
      if (keptSpans.some(kept => spansOverlap(kept, span))) return []
      originIdBySpanId.set(span.id, span.id)
      return [span]
    }
    const pieces = subtractLockedSpans(span, lockedSpans)
    for (const piece of pieces) originIdBySpanId.set(piece.id, span.id)
    return pieces
  })
  const voiceSpans = [...keptSpans, ...acceptedSpans].sort((a, b) =>
    a.paragraphIndex - b.paragraphIndex || a.startOffset - b.startOffset || a.endOffset - b.endOffset,
  )
  const currentCharacters = new Map(existing.voiceProject.characters.map(character => [character.id, character]))
  const voiceCharacters = proposed.voiceProject.characters.map(character => {
    const prior = currentCharacters.get(character.id)
    return prior?.locked ? prior : { ...character, voiceProfileId: prior?.voiceProfileId ?? character.voiceProfileId }
  })
  for (const character of existing.voiceProject.characters) {
    if ((mode === "fill_gaps" || character.locked) && !voiceCharacters.some(candidate => candidate.id === character.id)) voiceCharacters.push(character)
  }
  const voiceNotes = voiceSpans.map(span => {
    const fromCurrent = noteFor(existing, span.id)
    const fromProposal = noteFor(proposed, originIdBySpanId.get(span.id) ?? span.id)
    return fromCurrent?.locked || span.locked
      ? fromCurrent ?? defaultVoiceNote(span)
      : fromProposal ? { ...fromProposal, spanId: span.id } : fromCurrent ?? defaultVoiceNote(span)
  })

  const lockedRegions = existing.musicProject.regions.filter(region => region.locked)
  const keptRegions = mode === "fill_gaps" ? existing.musicProject.regions : lockedRegions
  const acceptedRegions = proposed.musicProject.regions.filter(region => !keptRegions.some(kept => regionsOverlap(kept, region)))
  const musicRegions = [...keptRegions, ...acceptedRegions].sort((a, b) => a.startParagraph - b.startParagraph)
  const musicNodes = musicRegions.map(region => {
    const fromCurrent = nodeFor(existing, region.id)
    const fromProposal = nodeFor(proposed, region.id)
    return fromCurrent?.locked || region.locked
      ? fromCurrent ?? defaultMusicNode(region)
      : fromProposal ?? fromCurrent ?? defaultMusicNode(region)
  })

  return advancedDirectionProjectSchema.parse({
    ...proposed,
    voiceProject: {
      ...proposed.voiceProject,
      narratorVoiceProfileId: existing.voiceProject.narratorVoiceProfileId ?? proposed.voiceProject.narratorVoiceProfileId,
      characters: voiceCharacters,
      spans: voiceSpans,
    },
    musicProject: { ...proposed.musicProject, regions: musicRegions },
    voiceNotes,
    musicNodes,
  })
}

const performanceByDelivery: Record<SpeechSpanV1["delivery"], Omit<DirectionVoiceNoteV2, "spanId" | "source" | "locked" | "note">> = {
  neutral: { emotion: "neutral", projection: "natural", vocalState: "none", intensity: 0.35, elevenLabsTags: [] },
  calm: { emotion: "calm", projection: "soft", vocalState: "none", intensity: 0.25, elevenLabsTags: ["calm"] },
  warm: { emotion: "warm", projection: "soft", vocalState: "smiling", intensity: 0.4, elevenLabsTags: ["warm", "soft"] },
  tense: { emotion: "tension", projection: "natural", vocalState: "trembling", intensity: 0.7, elevenLabsTags: ["tense"] },
  sad: { emotion: "sadness", projection: "soft", vocalState: "near_tears", intensity: 0.65, elevenLabsTags: ["sad", "near tears"] },
  joyful: { emotion: "joy", projection: "projected", vocalState: "smiling", intensity: 0.7, elevenLabsTags: ["joyful"] },
  whispered: { emotion: "neutral", projection: "whisper", vocalState: "none", intensity: 0.25, elevenLabsTags: ["whispering"] },
  firm: { emotion: "anger", projection: "projected", vocalState: "none", intensity: 0.7, elevenLabsTags: ["firm"] },
}

export function defaultVoiceNote(span: SpeechSpanV1): DirectionVoiceNoteV2 {
  return directionVoiceNoteSchema.parse({
    spanId: span.id,
    ...performanceByDelivery[span.delivery],
    source: span.source === "oracle" ? "agent" : "manual",
    locked: span.locked,
    note: span.note,
  })
}

export function defaultMusicNode(region: NarrativeProjectV1["regions"][number], layerIds: number[] = []): DirectionMusicNodeV2 {
  return directionMusicNodeSchema.parse({
    regionId: region.id,
    scoreId: region.scoreId,
    layerIds,
    entry: region.startParagraph === 0 ? "fade_in" : "crossfade",
    exit: "crossfade",
    crossfadeSeconds: region.transition.preferredSeconds,
    source: region.source === "oracle" ? "agent" : "manual",
    locked: region.locked,
    note: region.note,
  })
}

export function createEmptyAdvancedDirection(input: {
  bookId: number
  chapterIndex: number
  contentHash: string
  language: string
  revision?: number
}): AdvancedDirectionProjectV2 {
  const revision = Math.max(1, Math.trunc(input.revision ?? 1))
  const language = input.language.trim() || "es"
  return advancedDirectionProjectSchema.parse({
    version: ADVANCED_DIRECTION_VERSION,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    revision,
    contentHash: input.contentHash,
    language,
    voiceProject: {
      version: 1,
      bookId: input.bookId,
      chapterIndex: input.chapterIndex,
      revision,
      contentHash: input.contentHash,
      language,
      narratorVoiceProfileId: null,
      paragraphPauseMs: 650,
      characters: [],
      spans: [],
    },
    musicProject: {
      version: 1,
      bookId: input.bookId,
      chapterIndex: input.chapterIndex,
      revision,
      directionStyle: "subtle",
      defaultScoreId: null,
      regions: [],
    },
    voiceNotes: [],
    musicNodes: [],
    agentAudit: null,
  })
}

export function manualNarrationSpans(contentHash: string, paragraphs: readonly string[]): SpeechSpanV1[] {
  const anchor = /^[a-f0-9]{64}$/.test(contentHash) ? contentHash.slice(0, 10) : "draft"
  return paragraphs.map((paragraph, index) => ({
    id: `manual_narration_${anchor}_${index + 1}`,
    paragraphIndex: index,
    startOffset: 0,
    endOffset: paragraph.length,
    kind: "narration" as const,
    speakerId: "narrator",
    delivery: "neutral" as const,
    pace: 1,
    pauseBeforeMs: 0,
    pauseAfterMs: index === paragraphs.length - 1 ? 0 : 350,
    confidence: 1,
    source: "manual" as const,
    locked: false,
    note: "",
  })).filter(span => span.endOffset > 0)
}

export function createAdvancedDirection(input: {
  revision: number
  voiceProject: SpeechProjectV1
  musicProject: NarrativeProjectV1
  musicLayerIds?: ReadonlyMap<string, number[]>
  provider: string
  model: string
}): AdvancedDirectionProjectV2 {
  const revision = Math.max(1, Math.trunc(input.revision))
  const voiceProject = speechProjectSchema.parse({ ...input.voiceProject, revision })
  const musicProject = narrativeProjectSchema.parse({ ...input.musicProject, revision })
  return advancedDirectionProjectSchema.parse({
    version: ADVANCED_DIRECTION_VERSION,
    bookId: voiceProject.bookId,
    chapterIndex: voiceProject.chapterIndex,
    revision,
    contentHash: voiceProject.contentHash,
    language: voiceProject.language,
    voiceProject,
    musicProject,
    voiceNotes: voiceProject.spans.map(defaultVoiceNote),
    musicNodes: musicProject.regions.map(region => defaultMusicNode(region, input.musicLayerIds?.get(region.id) ?? [])),
    agentAudit: {
      promptVersion: DIRECTION_AGENT_PROMPT_VERSION,
      provider: input.provider,
      model: input.model,
      generatedAt: new Date().toISOString(),
    },
  })
}
