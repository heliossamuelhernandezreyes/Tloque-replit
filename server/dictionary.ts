export interface DictionarySense {
  partOfSpeech: string
  definition: string
  example: string
}

export interface DictionaryResult {
  word: string
  sourceLanguage: string
  targetLanguage: string
  senses: DictionarySense[]
  translation: string
  source: string
}

type Translate = (text: string, from: string, to: string) => Promise<string>

const CACHE_TTL = 6 * 60 * 60 * 1_000
const CACHE_MAX = 600
const cache = new Map<string, { expires: number; value: DictionaryResult }>()

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
  // Una misma grafía puede existir en muchos idiomas. Tomar el primer valor
  // del objeto mezclaría homónimos (por ejemplo, una voz latina con una
  // inglesa); aceptamos únicamente la entrada correspondiente a la lengua de
  // la obra, incluyendo variantes regionales del mismo código.
  const prioritized = Object.entries(record)
    .filter(([language]) => language === sourceLanguage || language.startsWith(`${sourceLanguage}-`))
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
        if (definition.length < 3 || seen.has(definition.toLocaleLowerCase())) continue
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
        seen.add(definition.toLocaleLowerCase())
        if (senses.length >= 4) return senses
      }
    }
  }
  return senses
}

function cacheSet(key: string, value: DictionaryResult) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, { expires: Date.now() + CACHE_TTL, value })
}

async function fetchWiktionary(
  word: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<{ senses: DictionarySense[]; source: string; definitionLanguage: string }> {
  // El sitio de destino explica la voz en el idioma elegido por el lector.
  // El sitio del libro y el inglés quedan como respaldos, nunca como mezcla oculta.
  const sites = [...new Set([targetLanguage, sourceLanguage, "en"])].slice(0, 3)
  for (const site of sites) {
    try {
      const url = `https://${site}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
      const response = await fetch(url, {
        headers: { "User-Agent": "Tloque/1.1 dictionary-proxy" },
        signal: AbortSignal.timeout(5_500),
      })
      if (!response.ok) continue
      const senses = extractWiktionarySenses(await response.json(), sourceLanguage)
      if (senses.length) return { senses, source: `wiktionary-${site}`, definitionLanguage: site }
    } catch { /* probar la siguiente fuente */ }
  }
  return { senses: [], source: "", definitionLanguage: targetLanguage }
}

async function fetchEnglishFallback(word: string): Promise<DictionarySense[]> {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(4_500) },
    )
    if (!response.ok) return []
    const data = await response.json()
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

export async function lookupDictionary(
  rawWord: string,
  sourceLanguage: string,
  targetLanguage: string,
  translate: Translate,
): Promise<DictionaryResult> {
  const word = rawWord.normalize("NFKC").trim().slice(0, 80)
  const key = `${sourceLanguage}:${targetLanguage}:${word.toLocaleLowerCase()}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  if (cached) cache.delete(key)

  const wiki = await fetchWiktionary(word, sourceLanguage, targetLanguage)
  let senses = wiki.senses
  let source = wiki.source
  let definitionLanguage = wiki.definitionLanguage
  if (!senses.length && sourceLanguage === "en") {
    senses = await fetchEnglishFallback(word)
    if (senses.length) {
      source = "free-dictionary"
      definitionLanguage = "en"
    }
  }

  // La primera consulta intenta la edición elegida por el lector. Si solo hay
  // definición en otra edición, normalizamos su texto al idioma de interfaz;
  // el ejemplo se conserva en la lengua de la obra como contexto de uso.
  if (senses.length && definitionLanguage !== targetLanguage) {
    const partsOfSpeech = [...new Set(senses.map(sense => sense.partOfSpeech).filter(Boolean))]
    const [definitions, translatedParts] = await Promise.all([
      Promise.all(senses.map(async sense => {
        try {
          return cleanDictionaryText(
            await translate(sense.definition, definitionLanguage, targetLanguage),
          ) || sense.definition
        } catch {
          return sense.definition
        }
      })),
      Promise.all(partsOfSpeech.map(async part => {
        try {
          return cleanDictionaryText(
            await translate(part, definitionLanguage, targetLanguage),
            80,
          ) || part
        } catch {
          return part
        }
      })),
    ])
    const partMap = new Map(partsOfSpeech.map((part, index) => [part, translatedParts[index]]))
    senses = senses.map((sense, index) => ({
      ...sense,
      definition: definitions[index],
      partOfSpeech: partMap.get(sense.partOfSpeech) || sense.partOfSpeech,
    }))
  }

  let translation = ""
  if (sourceLanguage !== targetLanguage) {
    try {
      const translated = cleanDictionaryText(
        await translate(word, sourceLanguage, targetLanguage),
        160,
      )
      if (translated && translated.toLocaleLowerCase() !== word.toLocaleLowerCase()) {
        translation = translated
      }
    } catch { /* una definición sigue siendo útil sin traducción */ }
  }

  const result = { word, sourceLanguage, targetLanguage, senses, translation, source }
  cacheSet(key, result)
  return result
}
