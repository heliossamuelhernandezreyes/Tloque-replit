export interface DictionarySense {
  partOfSpeech: string
  definition: string
  example: string
}

export interface DictionaryResult {
  word: string
  sourceLanguage: string
  targetLanguage: string
  definitionLanguage: string
  senses: DictionarySense[]
  translation: string
  source: string
  sourceUrl: string
}

type Translate = (text: string, from: string, to: string) => Promise<string>

const CACHE_TTL = 6 * 60 * 60 * 1_000
const EMPTY_CACHE_TTL = 10 * 60 * 1_000
const CACHE_MAX = 600
const MAX_RESPONSE_BYTES = 1_000_000
const cache = new Map<string, { expires: number; value: DictionaryResult }>()

export const DICTIONARY_LANGUAGES = new Set([
  "ar", "de", "el", "en", "es", "fi", "fr", "it",
  "ja", "la", "nl", "pl", "pt", "ru", "sv", "zh",
])

function baseLanguage(raw: unknown): string {
  return String(raw || "").trim().toLowerCase().replace(/_/g, "-").split("-", 1)[0]
}

export function normalizeDictionaryLanguage(raw: unknown, fallback = "es"): string {
  const normalizedFallback = baseLanguage(fallback || "es")
  const safeFallback = DICTIONARY_LANGUAGES.has(normalizedFallback) ? normalizedFallback : "es"
  const code = baseLanguage(raw)
  return DICTIONARY_LANGUAGES.has(code) ? code : safeFallback
}

export function cleanDictionaryText(raw: unknown, max = 700): string {
  if (typeof raw !== "string") return ""
  return raw
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

export function extractWiktionarySenses(data: unknown, sourceLanguage: string): DictionarySense[] {
  if (!data || typeof data !== "object") return []
  const record = data as Record<string, unknown>
  const source = normalizeDictionaryLanguage(sourceLanguage)
  // Una misma grafía puede existir en muchos idiomas. Nunca se toma el primer
  // valor del objeto: sólo se acepta la entrada de la lengua de la obra.
  const prioritized = Object.entries(record)
    .filter(([language]) => baseLanguage(language) === source)
    .map(([, entries]) => entries)
  const senses: DictionarySense[] = []
  const seen = new Set<string>()

  for (const candidate of prioritized) {
    if (!Array.isArray(candidate)) continue
    for (const entry of candidate) {
      const item = entry as any
      if (!Array.isArray(item?.definitions)) continue
      for (const rawSense of item.definitions) {
        const definition = cleanDictionaryText(rawSense?.definition)
        const fingerprint = definition.toLocaleLowerCase()
        if (definition.length < 3 || seen.has(fingerprint)) continue
        const parsedExample = Array.isArray(rawSense?.parsedExamples)
          ? rawSense.parsedExamples.find((example: any) => example?.example || example?.definition)
          : null
        const example = cleanDictionaryText(
          parsedExample?.example || parsedExample?.definition || rawSense?.examples?.[0],
          320,
        )
        senses.push({
          partOfSpeech: cleanDictionaryText(item?.partOfSpeech, 80),
          definition,
          example,
        })
        seen.add(fingerprint)
        if (senses.length >= 4) return senses
      }
    }
  }
  return senses
}

function cacheSet(key: string, value: DictionaryResult) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  const ttl = value.senses.length || value.translation ? CACHE_TTL : EMPTY_CACHE_TTL
  cache.set(key, { expires: Date.now() + ttl, value })
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") || 0)
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Dictionary response is too large")
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error("Dictionary response is too large")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function fetchWiktionaryEdition(
  word: string,
  sourceLanguage: string,
  site: string,
): Promise<DictionarySense[]> {
  try {
    const url = `https://${site}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Tloque/1.2 dictionary-proxy",
      },
      redirect: "error",
      signal: AbortSignal.timeout(5_500),
    })
    if (!response.ok) return []
    return extractWiktionarySenses(await readJsonWithLimit(response), sourceLanguage)
  } catch {
    return []
  }
}

async function fetchEnglishFallback(word: string): Promise<DictionarySense[]> {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      {
        headers: { "Accept": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(4_500),
      },
    )
    if (!response.ok) return []
    const data = await readJsonWithLimit(response) as any
    const senses: DictionarySense[] = []
    for (const meaning of data?.[0]?.meanings || []) {
      for (const item of meaning?.definitions || []) {
        const definition = cleanDictionaryText(item?.definition)
        if (!definition) continue
        senses.push({
          partOfSpeech: cleanDictionaryText(meaning?.partOfSpeech, 80),
          definition,
          example: cleanDictionaryText(item?.example, 320),
        })
        if (senses.length >= 4) return senses
      }
    }
    return senses
  } catch {
    return []
  }
}

function sameText(a: string, b: string): boolean {
  const normalize = (value: string) => value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim()
  return normalize(a) === normalize(b)
}

function isPlausibleTargetScript(text: string, language: string): boolean {
  if (!/\p{L}/u.test(text)) return false
  if (language === "ar") return /\p{Script=Arabic}/u.test(text)
  if (language === "el") return /\p{Script=Greek}/u.test(text)
  if (language === "ru") return /\p{Script=Cyrillic}/u.test(text)
  if (language === "zh") return /\p{Script=Han}/u.test(text)
  if (language === "ja") {
    return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  }
  return /\p{Script=Latin}/u.test(text)
}

async function strictTranslation(
  text: string,
  from: string,
  to: string,
  translate: Translate,
  max = 700,
): Promise<string> {
  const clean = cleanDictionaryText(text, max)
  if (!clean) return ""
  if (from === to) return clean
  try {
    const translated = cleanDictionaryText(await translate(clean, from, to), max)
    // Los proveedores usados por Tloque devuelven el original cuando fallan.
    // Aceptarlo filtraría precisamente el idioma que el lector no eligió.
    if (!translated || sameText(translated, clean) || !isPlausibleTargetScript(translated, to)) return ""
    return translated
  } catch {
    return ""
  }
}

export async function localizeDictionarySenses(
  senses: DictionarySense[],
  definitionLanguage: string,
  targetLanguage: string,
  translate: Translate,
): Promise<DictionarySense[]> {
  const from = normalizeDictionaryLanguage(definitionLanguage)
  const to = normalizeDictionaryLanguage(targetLanguage)
  if (from === to) return senses.map(sense => ({
    partOfSpeech: cleanDictionaryText(sense.partOfSpeech, 80),
    definition: cleanDictionaryText(sense.definition),
    example: cleanDictionaryText(sense.example, 320),
  })).filter(sense => sense.definition.length >= 3)

  const localized = await Promise.all(senses.slice(0, 4).map(async sense => {
    const [definition, partOfSpeech] = await Promise.all([
      strictTranslation(sense.definition, from, to, translate),
      strictTranslation(sense.partOfSpeech, from, to, translate, 80),
    ])
    if (!definition) return null
    // El ejemplo pertenece a la lengua original de la obra. Para no mezclarlo
    // de forma engañosa con la definición localizada se omite en el respaldo.
    return { definition, partOfSpeech, example: "" }
  }))
  return localized.filter((sense): sense is DictionarySense => sense !== null)
}

export async function lookupDictionary(
  rawWord: string,
  rawSourceLanguage: string,
  rawTargetLanguage: string,
  translate: Translate,
): Promise<DictionaryResult> {
  const word = rawWord.normalize("NFKC").trim().slice(0, 80)
  const sourceLanguage = normalizeDictionaryLanguage(rawSourceLanguage)
  const targetLanguage = normalizeDictionaryLanguage(rawTargetLanguage, sourceLanguage)
  const key = `${sourceLanguage}:${targetLanguage}:${word.toLocaleLowerCase()}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  if (cached) cache.delete(key)

  let senses: DictionarySense[] = []
  let source = ""
  let sourceUrl = ""
  // La edición del lector es la única que puede usarse sin traducción. Las
  // otras ediciones son respaldos y sólo se publican si la traducción resulta.
  const sites = [...new Set([targetLanguage, sourceLanguage, "en"])].slice(0, 3)
  for (const site of sites) {
    const candidate = await fetchWiktionaryEdition(word, sourceLanguage, site)
    if (!candidate.length) continue
    const localized = await localizeDictionarySenses(candidate, site, targetLanguage, translate)
    if (!localized.length) continue
    senses = localized
    source = `wiktionary-${site}`
    sourceUrl = `https://${site}.wiktionary.org/wiki/${encodeURIComponent(word)}`
    break
  }

  if (!senses.length && sourceLanguage === "en") {
    const candidate = await fetchEnglishFallback(word)
    const localized = await localizeDictionarySenses(candidate, "en", targetLanguage, translate)
    if (localized.length) {
      senses = localized
      source = "free-dictionary"
      sourceUrl = "https://dictionaryapi.dev/"
    }
  }

  let translation = ""
  if (sourceLanguage !== targetLanguage) {
    translation = await strictTranslation(word, sourceLanguage, targetLanguage, translate, 160)
  }

  const result: DictionaryResult = {
    word,
    sourceLanguage,
    targetLanguage,
    definitionLanguage: targetLanguage,
    senses,
    translation,
    source,
    sourceUrl,
  }
  cacheSet(key, result)
  return result
}
