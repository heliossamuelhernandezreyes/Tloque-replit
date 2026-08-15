import { z } from "zod"
import { narrativeParagraphsFor } from "@shared/narrative"
import {
  speechDeliverySchema,
  speechProjectSchema,
  type SpeechProjectV1,
} from "@shared/speech"

const rawCharacterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i),
  name: z.string().min(1).max(160),
  aliases: z.array(z.string().min(1).max(160)).max(20),
  confidence: z.number().min(0).max(1),
}).strict()

const rawSpanSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i),
  paragraphIndex: z.number().int().min(0),
  text: z.string().min(1),
  kind: z.enum(["narration", "dialogue"]),
  speakerId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i),
  delivery: speechDeliverySchema,
  pace: z.number().min(0.75).max(1.25),
  pauseBeforeMs: z.number().int().min(0).max(5_000),
  pauseAfterMs: z.number().int().min(0).max(5_000),
  confidence: z.number().min(0).max(1),
}).strict()

const rawSpeechDirectionSchema = z.object({
  language: z.string().min(2).max(12),
  paragraphPauseMs: z.number().int().min(0).max(5_000),
  characters: z.array(rawCharacterSchema).max(100),
  spans: z.array(rawSpanSchema).min(1).max(5_000),
}).strict()

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["language", "paragraphPauseMs", "characters", "spans"],
  properties: {
    language: { type: "string" },
    paragraphPauseMs: { type: "integer", minimum: 0, maximum: 5_000 },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "aliases", "confidence"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    spans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "paragraphIndex", "text", "kind", "speakerId", "delivery", "pace", "pauseBeforeMs", "pauseAfterMs", "confidence"],
        properties: {
          id: { type: "string" },
          paragraphIndex: { type: "integer", minimum: 0 },
          text: { type: "string" },
          kind: { type: "string", enum: ["narration", "dialogue"] },
          speakerId: { type: "string" },
          delivery: { type: "string", enum: speechDeliverySchema.options },
          pace: { type: "number", minimum: 0.75, maximum: 1.25 },
          pauseBeforeMs: { type: "integer", minimum: 0, maximum: 5_000 },
          pauseAfterMs: { type: "integer", minimum: 0, maximum: 5_000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

export interface SpeechOracleResult {
  project: SpeechProjectV1
  model: string
  inputTokens: number
  outputTokens: number
}

export function speechOracleConfigured(): boolean {
  const oracleProvider = String(process.env.ORACLE_PROVIDER || "groq").toLowerCase()
  return Boolean(String(process.env.GROQ_API_KEY || (oracleProvider === "groq" ? process.env.ORACLE_API_KEY : "") || "").trim())
}

export function speechOraclePrompt(): string {
  return [
    "Eres el director de voz editorial de Tloque.",
    "Divide TODO el capítulo en fragmentos continuos de narración o diálogo.",
    "REGLAS INQUEBRANTABLES:",
    "- Copia cada fragmento de text exactamente, carácter por carácter. No corrijas, resumas ni reescribas.",
    "- Cubre todo carácter no vacío del capítulo una sola vez y conserva el orden.",
    "- Narración usa speakerId=narrator. Diálogo usa el id estable del personaje.",
    "- Reconoce diálogos con raya larga (—), guion (-), comillas y contexto narrativo.",
    "- Si no sabes quién habla, crea un personaje estable como voz_desconocida_1 y usa confidence baja.",
    "- delivery describe actuación vocal, nunca efectos de sonido.",
    "- Las pausas deben ser sobrias: diálogo normal 100-500 ms; párrafo 450-900 ms; máximo 5000 ms sólo con justificación textual evidente.",
    "- No inventes música, ambientes, golpes ni sonidos.",
    "- Devuelve únicamente el JSON exigido.",
  ].join("\n")
}

function tokenCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export async function analyzeSpeechWithGroq(input: {
  bookId: number
  chapterIndex: number
  revision: number
  content: string
  contentHash: string
  signal?: AbortSignal
}): Promise<SpeechOracleResult> {
  const oracleProvider = String(process.env.ORACLE_PROVIDER || "groq").toLowerCase()
  const apiKey = String(process.env.GROQ_API_KEY || (oracleProvider === "groq" ? process.env.ORACLE_API_KEY : "") || "").trim()
  if (!apiKey) throw new Error("El análisis de voz con Groq no está configurado")
  const model = String(
    process.env.GROQ_SPEECH_MODEL
    || (oracleProvider === "groq" ? process.env.ORACLE_MODEL : "")
    || "openai/gpt-oss-120b",
  )
  const paragraphs = narrativeParagraphsFor(input.content)
  const numbered = paragraphs.map((paragraph, index) => `[PÁRRAFO ${index}]\n${paragraph}`).join("\n\n")
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_completion_tokens: 12_000,
      response_format: {
        type: "json_schema",
        json_schema: { name: "tloque_speech_direction_v1", strict: true, schema: responseJsonSchema },
      },
      messages: [
        { role: "system", content: speechOraclePrompt() },
        { role: "user", content: numbered },
      ],
    }),
    signal: input.signal ?? AbortSignal.timeout(90_000),
  })
  const payload = await response.json().catch(() => null) as any
  if (!response.ok) throw new Error(payload?.error?.message || `Groq respondió HTTP ${response.status}`)
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error("Groq devolvió una dirección de voz vacía")
  const raw = rawSpeechDirectionSchema.parse(JSON.parse(content))
  const characterIds = new Set<string>()
  for (const character of raw.characters) {
    if (characterIds.has(character.id)) throw new Error("Groq repitió un identificador de personaje")
    characterIds.add(character.id)
  }
  const spanIds = new Set<string>()
  const cursorByParagraph = new Map<number, number>()
  const knownCharacters = characterIds
  const spans = raw.spans.map((span, index) => {
    if (spanIds.has(span.id)) throw new Error("Groq repitió un identificador de fragmento")
    spanIds.add(span.id)
    const paragraph = paragraphs[span.paragraphIndex]
    if (paragraph === undefined) throw new Error("Groq apuntó fuera del capítulo")
    const cursor = cursorByParagraph.get(span.paragraphIndex) ?? 0
    const startOffset = paragraph.indexOf(span.text, cursor)
    if (startOffset < 0) throw new Error("Groq modificó el manuscrito; no se aceptó la propuesta")
    if (paragraph.slice(cursor, startOffset).trim()) throw new Error("Groq dejó texto sin identificar")
    const endOffset = startOffset + span.text.length
    cursorByParagraph.set(span.paragraphIndex, endOffset)
    if (span.kind === "dialogue" && !knownCharacters.has(span.speakerId)) {
      throw new Error("Groq usó un personaje que no declaró")
    }
    return {
      id: span.id || `speech-${index + 1}`,
      paragraphIndex: span.paragraphIndex,
      startOffset,
      endOffset,
      kind: span.kind,
      speakerId: span.speakerId,
      delivery: span.delivery,
      pace: span.pace,
      pauseBeforeMs: span.pauseBeforeMs,
      pauseAfterMs: span.pauseAfterMs,
      confidence: span.confidence,
      source: "oracle" as const,
      locked: false,
      note: "",
    }
  })
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const cursor = cursorByParagraph.get(paragraphIndex) ?? 0
    if (paragraphs[paragraphIndex].slice(cursor).trim()) {
      throw new Error(`Groq dejó texto sin identificar en el párrafo ${paragraphIndex + 1}`)
    }
  }
  const project = speechProjectSchema.parse({
    version: 1,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    revision: Math.max(1, input.revision),
    contentHash: input.contentHash,
    language: raw.language,
    narratorVoiceProfileId: null,
    paragraphPauseMs: raw.paragraphPauseMs,
    characters: raw.characters.map(character => ({
      ...character,
      voiceProfileId: null,
      source: "oracle" as const,
      locked: false,
    })),
    spans,
  })
  return {
    project,
    model,
    inputTokens: tokenCount(payload?.usage?.prompt_tokens),
    outputTokens: tokenCount(payload?.usage?.completion_tokens),
  }
}
