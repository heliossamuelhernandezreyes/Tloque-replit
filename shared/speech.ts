import { z } from "zod"
import { narrativeParagraphsFor } from "./narrative"
import { paperChargeFor } from "./paper"

export const SPEECH_PROJECT_VERSION = 1 as const
export const SPEECH_PROFILE_VERSION = 1 as const

const unitSchema = z.number().finite().min(0).max(1)
const identifierSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/i)
const voiceIdSchema = z.number().int().positive().nullable()

export const speechDeliverySchema = z.enum([
  "neutral", "calm", "warm", "tense", "sad", "joyful", "whispered", "firm",
])

export const speechCharacterSchema = z.object({
  id: identifierSchema.refine(id => id !== "narrator", "narrator es un identificador reservado"),
  name: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  voiceProfileId: voiceIdSchema.default(null),
  confidence: unitSchema.default(1),
  source: z.enum(["manual", "oracle"]).default("manual"),
  locked: z.boolean().default(false),
}).strict()

const speechSpanObjectSchema = z.object({
  id: identifierSchema,
  paragraphIndex: z.number().int().min(0),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  kind: z.enum(["narration", "dialogue"]),
  speakerId: identifierSchema,
  delivery: speechDeliverySchema.default("neutral"),
  pace: z.number().finite().min(0.75).max(1.25).default(1),
  pauseBeforeMs: z.number().int().min(0).max(5_000).default(0),
  pauseAfterMs: z.number().int().min(0).max(5_000).default(250),
  confidence: unitSchema.default(1),
  source: z.enum(["manual", "oracle"]).default("manual"),
  locked: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
}).strict()

export const speechSpanSchema = speechSpanObjectSchema.superRefine((span, ctx) => {
  if (span.endOffset <= span.startOffset) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endOffset"], message: "El final debe estar después del inicio" })
  }
  if (span.kind === "narration" && span.speakerId !== "narrator") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["speakerId"], message: "La narración debe usar narrator" })
  }
  if (span.kind === "dialogue" && span.speakerId === "narrator") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["speakerId"], message: "El diálogo necesita un personaje" })
  }
})

export const speechProjectSchema = z.object({
  version: z.literal(SPEECH_PROJECT_VERSION),
  bookId: z.number().int().positive(),
  chapterIndex: z.number().int().min(0),
  revision: z.number().int().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.string().trim().min(2).max(12).default("es"),
  narratorVoiceProfileId: voiceIdSchema.default(null),
  paragraphPauseMs: z.number().int().min(0).max(5_000).default(650),
  characters: z.array(speechCharacterSchema).max(100).default([]),
  spans: z.array(speechSpanSchema).max(5_000).default([]),
}).strict()

export type SpeechDelivery = z.infer<typeof speechDeliverySchema>
export type SpeechCharacterV1 = z.infer<typeof speechCharacterSchema>
export type SpeechSpanV1 = z.infer<typeof speechSpanSchema>
export type SpeechProjectV1 = z.infer<typeof speechProjectSchema>

export const speechSegmentSchema = speechSpanObjectSchema.omit({
  source: true,
  locked: true,
  note: true,
}).extend({
  text: z.string().min(1),
  voiceProfileId: z.number().int().positive(),
})

export const speechProfileSchema = z.object({
  version: z.literal(SPEECH_PROFILE_VERSION),
  bookId: z.number().int().positive(),
  chapterIndex: z.number().int().min(0),
  revision: z.number().int().min(1),
  compiledFromProjectRevision: z.number().int().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.string().trim().min(2).max(12),
  paragraphPauseMs: z.number().int().min(0).max(5_000),
  characterCount: z.number().int().min(1),
  segments: z.array(speechSegmentSchema).min(1).max(5_000),
}).strict()

export type SpeechSegmentV1 = z.infer<typeof speechSegmentSchema>
export type SpeechProfileV1 = z.infer<typeof speechProfileSchema>

export class SpeechCompilationError extends Error {
  public constructor(message: string, public readonly spanId?: string) {
    super(message)
    this.name = "SpeechCompilationError"
  }
}

export interface SpeechReadiness {
  ready: boolean
  issues: string[]
  characterCount: number
  estimatedPaper: number
}

export interface AudiobookPreflight {
  characterCount: number
  estimatedPaper: number
  paperBalance: number
  allowed: boolean
}

export function audiobookPreflight(characterCount: number, paperBalance: number): AudiobookPreflight {
  const characters = Number.isFinite(characterCount) ? Math.max(0, Math.trunc(characterCount)) : 0
  const balance = Number.isFinite(paperBalance) ? Math.max(0, Math.trunc(paperBalance)) : 0
  const estimatedPaper = paperChargeFor("elevenlabs", characters)
  return { characterCount: characters, estimatedPaper, paperBalance: balance, allowed: characters > 0 && balance >= estimatedPaper }
}

export function assertAudiobookCharacterCount(expected: number, actual: number): void {
  if (!Number.isInteger(expected) || expected <= 0 || actual !== expected) {
    throw new SpeechCompilationError("El proveedor debe sintetizar exactamente todo el texto aprobado")
  }
}

export function compileSpeechProject(
  input: SpeechProjectV1,
  content: string,
  contentHash: string,
  availableVoiceIds: ReadonlySet<number>,
): SpeechProfileV1 {
  const project = speechProjectSchema.parse(input)
  if (project.contentHash !== contentHash) {
    throw new SpeechCompilationError("El manuscrito cambió; vuelve a analizar el capítulo")
  }
  if (!project.narratorVoiceProfileId || !availableVoiceIds.has(project.narratorVoiceProfileId)) {
    throw new SpeechCompilationError("Selecciona una voz disponible para el narrador")
  }

  const characters = new Map<string, SpeechCharacterV1>()
  for (const character of project.characters) {
    if (characters.has(character.id)) throw new SpeechCompilationError("Cada personaje necesita un identificador único")
    if (!character.voiceProfileId || !availableVoiceIds.has(character.voiceProfileId)) {
      throw new SpeechCompilationError(`Selecciona una voz disponible para ${character.name}`)
    }
    characters.set(character.id, character)
  }

  const paragraphs = narrativeParagraphsFor(content)
  const ordered = [...project.spans].sort((a, b) =>
    a.paragraphIndex - b.paragraphIndex || a.startOffset - b.startOffset || a.endOffset - b.endOffset,
  )
  const spanIds = new Set<string>()
  const cursorByParagraph = new Map<number, number>()
  const segments: SpeechSegmentV1[] = []

  for (const span of ordered) {
    if (spanIds.has(span.id)) throw new SpeechCompilationError("Cada fragmento necesita un identificador único", span.id)
    spanIds.add(span.id)
    const paragraph = paragraphs[span.paragraphIndex]
    if (paragraph === undefined || span.endOffset > paragraph.length) {
      throw new SpeechCompilationError("El fragmento termina fuera del párrafo", span.id)
    }
    const cursor = cursorByParagraph.get(span.paragraphIndex) ?? 0
    if (span.startOffset < cursor) throw new SpeechCompilationError("Los fragmentos de voz no pueden solaparse", span.id)
    if (paragraph.slice(cursor, span.startOffset).trim()) {
      throw new SpeechCompilationError("La dirección de voz dejó texto sin cubrir", span.id)
    }
    const text = paragraph.slice(span.startOffset, span.endOffset)
    if (!text.trim()) throw new SpeechCompilationError("Un fragmento de voz no puede estar vacío", span.id)
    const character = span.speakerId === "narrator" ? null : characters.get(span.speakerId)
    if (span.kind === "dialogue" && !character) {
      throw new SpeechCompilationError("El diálogo apunta a un personaje inexistente", span.id)
    }
    segments.push(speechSegmentSchema.parse({
      id: span.id,
      paragraphIndex: span.paragraphIndex,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      kind: span.kind,
      speakerId: span.speakerId,
      delivery: span.delivery,
      pace: span.pace,
      pauseBeforeMs: span.pauseBeforeMs,
      pauseAfterMs: span.pauseAfterMs,
      confidence: span.confidence,
      text,
      voiceProfileId: character?.voiceProfileId ?? project.narratorVoiceProfileId,
    }))
    cursorByParagraph.set(span.paragraphIndex, span.endOffset)
  }

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const cursor = cursorByParagraph.get(paragraphIndex) ?? 0
    if (paragraphs[paragraphIndex].slice(cursor).trim()) {
      throw new SpeechCompilationError(`El párrafo ${paragraphIndex + 1} tiene texto sin dirigir`)
    }
  }
  if (segments.length === 0) throw new SpeechCompilationError("El capítulo no tiene fragmentos de voz")
  const characterCount = segments.reduce((total, segment) => total + segment.text.length, 0)
  return speechProfileSchema.parse({
    version: 1,
    bookId: project.bookId,
    chapterIndex: project.chapterIndex,
    revision: project.revision,
    compiledFromProjectRevision: project.revision,
    contentHash,
    language: project.language,
    paragraphPauseMs: project.paragraphPauseMs,
    characterCount,
    segments,
  })
}

export function speechReadiness(
  project: SpeechProjectV1,
  content: string,
  contentHash: string,
  availableVoiceIds: ReadonlySet<number>,
): SpeechReadiness {
  try {
    const profile = compileSpeechProject(project, content, contentHash, availableVoiceIds)
    return {
      ready: true,
      issues: [],
      characterCount: profile.characterCount,
      estimatedPaper: paperChargeFor("elevenlabs", profile.characterCount),
    }
  } catch (error) {
    return {
      ready: false,
      issues: [error instanceof Error ? error.message : "La dirección de voz está incompleta"],
      characterCount: 0,
      estimatedPaper: 0,
    }
  }
}

export function speechCacheMaterial(profile: SpeechProfileV1, modelId: string): string {
  return JSON.stringify({
    contract: `speech-profile@${profile.version}`,
    bookId: profile.bookId,
    chapterIndex: profile.chapterIndex,
    contentHash: profile.contentHash,
    revision: profile.revision,
    language: profile.language,
    paragraphPauseMs: profile.paragraphPauseMs,
    modelId,
    segments: profile.segments.map(segment => ({
      id: segment.id,
      text: segment.text,
      voiceProfileId: segment.voiceProfileId,
      delivery: segment.delivery,
      pace: segment.pace,
      pauseBeforeMs: segment.pauseBeforeMs,
      pauseAfterMs: segment.pauseAfterMs,
    })),
  })
}
