import {
  narrativeProjectSchema,
  compileNarrativeProject,
  paragraphCountFor,
  type NarrativeProjectV1,
} from "@shared/narrative"

const oracleDirectionSchema = narrativeProjectSchema.pick({
  directionStyle: true,
  defaultScoreId: true,
  regions: true,
}).strict()

export interface OracleScoreSummary {
  id: number
  title: string
  bpm: number | null
  tags: string[]
  layerTags: string[]
}

export interface OracleUsage {
  inputTokens: number
  outputTokens: number
}

export interface OracleResult {
  project: NarrativeProjectV1
  provider: "groq" | "xai"
  model: string
  usage: OracleUsage
}

interface OracleConfig {
  provider: "groq" | "xai"
  apiKey: string
  baseUrl: string
  model: string
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, "")
}

export function oracleConfig(): OracleConfig | null {
  const provider = String(process.env.ORACLE_PROVIDER || "groq").toLowerCase()
  if (provider !== "groq" && provider !== "xai") return null
  const apiKey = String(
    process.env.ORACLE_API_KEY ||
    (provider === "groq" ? process.env.GROQ_API_KEY : process.env.XAI_API_KEY) ||
    "",
  ).trim()
  if (!apiKey) return null
  const defaultBase = provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.x.ai/v1"
  const defaultModel = provider === "groq" ? "openai/gpt-oss-120b" : "grok-4"
  const baseUrl = cleanBaseUrl(String(process.env.ORACLE_BASE_URL || defaultBase))
  try {
    const parsed = new URL(baseUrl)
    const localDev = process.env.NODE_ENV !== "production"
      && parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    if (parsed.protocol !== "https:" && !localDev) return null
    if (parsed.username || parsed.password) return null
  } catch { return null }
  return {
    provider,
    apiKey,
    baseUrl,
    model: String(process.env.ORACLE_MODEL || defaultModel),
  }
}

export function oracleMasterPrompt(paragraphCount: number, scores: OracleScoreSummary[]): string {
  return [
    "Eres Oráculo, director musical editorial de Tloque.",
    "Tu trabajo es proponer música incidental que acompañe la lectura sin competir con ella.",
    "REGLAS INQUEBRANTABLES:",
    "- No propongas efectos de sonido, foley, stingers, golpes, choques de espada, explosiones ni sonidos que imiten una acción.",
    "- No sincronices música con una palabra o una acción exacta. Usa regiones amplias de varios párrafos.",
    "- Ante ambigüedad, conserva la música anterior y usa transiciones lentas de 8 a 30 segundos.",
    "- La percusión sólo puede ser none, subtle o gradual. Nunca debe dominar.",
    "- Usa exclusivamente scoreId y layerTags presentes en el catálogo. Si no hay coincidencia segura, usa scoreId null y pocas etiquetas musicales.",
    "- Devuelve entre 0 y 12 regiones no solapadas, ordenadas, dentro del capítulo.",
    "- Cada región debe tener startParagraph <= preferredParagraph <= endParagraph.",
    "- confidence mide tu certeza editorial; usa valores bajos cuando el cambio no sea claro.",
    "- La salida debe ser sólo JSON válido, sin Markdown ni explicación.",
    `El capítulo tiene ${paragraphCount} párrafos, numerados de 0 a ${Math.max(0, paragraphCount - 1)}.`,
    `Catálogo musical: ${JSON.stringify(scores)}`,
    "Forma exacta: {directionStyle,defaultScoreId,regions:[{id,name,startParagraph,preferredParagraph,endParagraph,mood,targetIntensity,tension,warmth,density,texture,percussion,transition:{minimumSeconds,preferredSeconds,maximumSeconds},scoreId,layerTags,confidence,source,locked,note}]}",
    "Usa source=oracle, locked=false. id debe ser estable y legible, por ejemplo region-01.",
  ].join("\n")
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try { return JSON.parse(trimmed) } catch { /* algunos proveedores envuelven JSON */ }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("Oráculo no devolvió JSON")
  return JSON.parse(trimmed.slice(start, end + 1))
}

function asTokenCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export async function directChapterWithOracle(input: {
  bookId: number
  chapterIndex: number
  revision: number
  content: string
  scores: OracleScoreSummary[]
  signal?: AbortSignal
}): Promise<OracleResult> {
  const config = oracleConfig()
  if (!config) throw new Error("Oráculo no está configurado")
  const paragraphCount = paragraphCountFor(input.content)
  const prompt = oracleMasterPrompt(paragraphCount, input.scores)
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.15,
      max_completion_tokens: 4_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Analiza este capítulo y devuelve la dirección musical lateral:\n\n${input.content}` },
      ],
    }),
    signal: input.signal ?? AbortSignal.timeout(90_000),
  })
  const payload = await response.json().catch(() => null) as any
  if (!response.ok) {
    const providerMessage = payload?.error?.message || `HTTP ${response.status}`
    throw new Error(`Oráculo rechazó la solicitud: ${providerMessage}`)
  }
  const raw = payload?.choices?.[0]?.message?.content
  if (typeof raw !== "string") throw new Error("Oráculo devolvió una respuesta vacía")
  const direction = oracleDirectionSchema.parse(extractJson(raw))
  const scoreById = new Map(input.scores.map(score => [score.id, score]))
  const knownScore = (id: number | null) => id !== null && scoreById.has(id) ? id : null
  const seenIds = new Set<string>()
  const project = narrativeProjectSchema.parse({
    version: 1,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    revision: Math.max(1, input.revision),
    directionStyle: direction.directionStyle,
    defaultScoreId: knownScore(direction.defaultScoreId),
    regions: direction.regions.map((region, index) => {
      const scoreId = knownScore(region.scoreId)
      const effectiveScore = scoreById.get(scoreId ?? knownScore(direction.defaultScoreId) ?? -1)
      const allowedTags = new Set(effectiveScore?.layerTags ?? [])
      let id = region.id
      if (seenIds.has(id)) id = `oracle-${String(index + 1).padStart(2, "0")}`
      seenIds.add(id)
      return {
        ...region,
        id,
        scoreId,
        layerTags: [...new Set(region.layerTags.filter(tag => allowedTags.has(tag)))],
        source: "oracle" as const,
        locked: false,
      }
    }),
  })
  // La propuesta no se cobra ni se muestra si no compila de forma
  // determinista contra los límites reales del capítulo.
  compileNarrativeProject(project, paragraphCount)
  return {
    project,
    provider: config.provider,
    model: config.model,
    usage: {
      inputTokens: asTokenCount(payload?.usage?.prompt_tokens),
      outputTokens: asTokenCount(payload?.usage?.completion_tokens),
    },
  }
}
