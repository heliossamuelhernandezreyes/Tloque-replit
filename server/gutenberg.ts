import { GUTENBERG_LANGUAGES, GUTENBERG_TOPICS, gutenbergIdFromQuery,
  type GutenbergBook, type GutenbergCatalogPage, type GutenbergSort, type GutenbergTopic,
  type ProcessedGutenbergBook } from "../shared/gutenberg"
import { GutenbergCache } from "./gutenberg-cache"
export type { GutenbergBook } from "../shared/gutenberg"
export type ProcessedBook = ProcessedGutenbergBook

export class GutenbergSourceError extends Error {
  readonly status = 503
}

const metadataCache = new GutenbergCache<GutenbergBook | null>({ entries: 100, bytes: 4_000_000, pending: 8, ttl: 900_000 })
const catalogCache = new GutenbergCache<GutenbergCatalogPage>({ entries: 40, bytes: 6_000_000, pending: 8, ttl: 120_000 })
const processedCache = new GutenbergCache<ProcessedBook>({ entries: 6, bytes: 32_000_000, pending: 2, ttl: 600_000 })

// The deadline includes streaming the body, not just receiving HTTP headers.
async function fetchBytes(url: string, maxBytes: number, timeoutMs = 12_000): Promise<Uint8Array | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "error" })
    if (res.status === 404) { await res.body?.cancel(); return null }
    if (!res.ok) {
      await res.body?.cancel()
      throw new GutenbergSourceError(`La fuente de Gutenberg respondió ${res.status}. Inténtalo de nuevo.`)
    }
    return await readBodyWithLimit(res, maxBytes, controller.signal)
  } catch (error) {
    if (error instanceof GutenbergSourceError) throw error
    throw new GutenbergSourceError(controller.signal.aborted
      ? "Gutenberg tardó demasiado en responder. Vuelve a intentarlo."
      : "No se pudo consultar Gutenberg. Revisa la conexión e inténtalo de nuevo.")
  } finally { clearTimeout(timer) }
}

function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

async function readBodyWithLimit(res: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") || 0)
  if (declared > maxBytes) { await res.body?.cancel(); throw new GutenbergSourceError("El texto excede el tamaño permitido") }
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener("abort", cancel, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) throw new Error("Timeout")
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) throw new GutenbergSourceError("El texto excede el tamaño permitido")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener("abort", cancel)
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

// Node y algunos runtimes mínimos han tratado históricamente la etiqueta
// windows-1252 como ISO-8859-1. La tabla explícita conserva comillas, rayas y
// otros signos editoriales sin depender del ICU instalado en el servidor.
const WINDOWS_1252_C1 = [
  "€", "\u0081", "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "Š", "‹", "Œ", "\u008d", "Ž", "\u008f",
  "\u0090", "‘", "’", "“", "”", "•", "–", "—",
  "˜", "™", "š", "›", "œ", "\u009d", "ž", "Ÿ",
] as const

function decodeWindows1252(bytes: Uint8Array): string {
  let text = ""
  for (const byte of bytes) {
    text += byte >= 0x80 && byte <= 0x9f
      ? WINDOWS_1252_C1[byte - 0x80]
      : String.fromCharCode(byte)
  }
  return text
}

function isGutenbergBook(value: unknown): value is GutenbergBook {
  if (!value || typeof value !== "object") return false
  const book = value as Partial<GutenbergBook>
  return Number.isSafeInteger(book.id)
    && (book.id as number) > 0
    && (book.id as number) <= 999_999_999
    && typeof book.title === "string"
    && book.title.length > 0
    && book.title.length <= 1_000
    && Number.isSafeInteger(book.download_count) && (book.download_count as number) >= 0
    && Array.isArray(book.languages) && book.languages.length <= 30
    && book.languages.every(code => typeof code === "string" && /^[a-z]{2,3}$/i.test(code))
    && Array.isArray(book.authors) && book.authors.length <= 100
    && book.authors.every(person => person && typeof person.name === "string" && person.name.length <= 300)
    && Array.isArray(book.subjects) && book.subjects.length <= 200
    && book.subjects.every(subject => typeof subject === "string" && subject.length <= 1_000)
    && !!book.formats
    && typeof book.formats === "object" && !Array.isArray(book.formats)
    && Object.keys(book.formats).length <= 60
    && Object.entries(book.formats).every(([mime, url]) => mime.length <= 200 && typeof url === "string" && url.length <= 2_000)
    && (book.summaries === undefined || Array.isArray(book.summaries) && book.summaries.length <= 10
      && book.summaries.every(summary => typeof summary === "string" && summary.length <= 20_000))
    && (book.translators === undefined || Array.isArray(book.translators) && book.translators.length <= 100
      && book.translators.every(person => person && typeof person.name === "string" && person.name.length <= 300))
}

export async function fetchGutenbergBookById(id: number): Promise<GutenbergBook | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 999_999_999) return null
  return metadataCache.get(String(id), async () => {
    const bytes = await fetchBytes(`https://gutendex.com/books/${id}/`, 1_500_000)
    if (!bytes) return null
    const value: unknown = parseMetadata(bytes)
    if (!isGutenbergBook(value) || value.id !== id) throw new GutenbergSourceError("Gutendex devolvió metadatos inválidos")
    return value
  })
}

// ── IDIOMAS SOPORTADOS ───────────────────────────────────
export const SUPPORTED_LANGUAGES: Record<string, string> = Object.fromEntries(GUTENBERG_LANGUAGES)

// Normalizar texto: quitar tildes y pasar a minúsculas
function normalizeQuery(q: string): string {
  return q.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
}

export function normalizeGutenbergLanguage(lang: string): string {
  const base = String(lang || "").trim().toLowerCase().split(/[-_]/)[0]
  return Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, base) ? base : "es"
}

export function isGutenbergAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && ["gutenberg.org", "www.gutenberg.org"].includes(url.hostname)
      && !url.username && !url.password && !url.port
      && /^\/(?:files|cache\/epub)\//.test(url.pathname)
  } catch { return false }
}

function plainTextUrl(book: GutenbergBook): string | undefined {
  return Object.entries(book.formats)
    .filter(([mime, url]) => mime.toLowerCase().startsWith("text/plain") && isGutenbergAssetUrl(url))
    .sort(([a], [b]) => Number(/utf-8/i.test(b)) - Number(/utf-8/i.test(a)))[0]?.[1]
}

export function gutenbergCover(book: GutenbergBook): string {
  const cover = book.formats["image/jpeg"] || book.formats["image/png"] || ""
  return isGutenbergAssetUrl(cover) ? cover : ""
}

function classifyLanguage(book: GutenbergBook, requestedLanguage: string): GutenbergBook["languageMatch"] {
  if (!book.languages.includes(requestedLanguage)) return "alternative"
  return book.languages.length > 1 ? "multilingual" : "exact"
}

function parseMetadata(bytes: Uint8Array): any {
  try { return JSON.parse(new TextDecoder().decode(bytes)) }
  catch { throw new GutenbergSourceError("Gutendex devolvió una respuesta inválida. Inténtalo de nuevo.") }
}

export async function browseGutenberg(options: {
  query?: string; lang?: string; page?: number; sort?: GutenbergSort; topic?: GutenbergTopic
} = {}): Promise<GutenbergCatalogPage> {
  const query = String(options.query || "").trim().replace(/\s+/g, " ").slice(0, 120)
  const language = options.lang === "all" ? "all" : normalizeGutenbergLanguage(options.lang || "es")
  const page = options.page ?? 1
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw new Error("Página inválida")
  const sort: GutenbergSort = options.sort || "popular"
  const topic: GutenbergTopic = options.topic ?? ""
  if (!["popular", "ascending", "descending"].includes(sort) || !GUTENBERG_TOPICS.includes(topic)) throw new Error("Filtros inválidos")
  const key = JSON.stringify([query, language, page, sort, topic])
  return catalogCache.get(key, async () => {
    const base = { query, language, page, sort, topic, previousPage: page > 1 ? page - 1 : null }
    const id = gutenbergIdFromQuery(query)
    let books: GutenbergBook[], count: number, nextPage: number | null = null
    if (id) {
      const book = page === 1 ? await fetchGutenbergBookById(id) : null
      books = book ? [book] : []; count = books.length
    } else {
      const url = new URL("https://gutendex.com/books/")
      if (query) url.searchParams.set("search", query)
      if (language !== "all") url.searchParams.set("languages", language)
      if (topic) url.searchParams.set("topic", topic)
      url.searchParams.set("mime_type", "text/plain")
      url.searchParams.set("copyright", "false")
      url.searchParams.set("sort", sort)
      url.searchParams.set("page", String(page))
      const bytes = await fetchBytes(url.toString(), 1_500_000)
      if (!bytes) {
        if (page > 1) return { ...base, results: [], count: 0, nextPage: null }
        throw new GutenbergSourceError("El catálogo de Gutenberg no está disponible.")
      }
      const data = parseMetadata(bytes)
      if (!data || !Array.isArray(data.results) || data.results.length > 32
        || !Number.isSafeInteger(data.count) || data.count < 0
        || data.results.some((book: unknown) => !isGutenbergBook(book))) {
        throw new GutenbergSourceError("Gutendex devolvió metadatos inválidos")
      }
      books = data.results
      count = data.count
      // Treat next as a hint only. Never fetch a URL supplied by the response.
      if (typeof data.next === "string" && page < 5000) {
        try {
          const next = new URL(data.next)
          if (next.origin === url.origin && next.pathname === url.pathname
            && Number(next.searchParams.get("page")) === page + 1) nextPage = page + 1
        } catch { /* invalid continuation is not followed */ }
      }
    }
    const seen = new Set<number>()
    const results = books.filter(book => {
      if (seen.has(book.id) || book.copyright !== false || !plainTextUrl(book)
        || language !== "all" && !book.languages.includes(language)) return false
      seen.add(book.id); return true
    }).map(book => ({ ...book, coverUrl: gutenbergCover(book),
      requestedLanguage: language, languageMatch: classifyLanguage(book, language) }))
    return { ...base, results, count: id ? results.length : count, nextPage }
  })
}

// Compatibility for existing API consumers. The explorer uses the paginated,
// strict-language catalogue and only searches all languages when explicitly chosen.
export async function searchGutenberg(query: string, lang = "es"): Promise<GutenbergBook[]> {
  if (!query.trim()) return []
  const language = normalizeGutenbergLanguage(lang)
  let page = await browseGutenberg({ query, lang: language })
  const normalized = normalizeQuery(query)
  if (!page.results.length && normalized !== query.toLowerCase()) page = await browseGutenberg({ query: normalized, lang: language })
  if (page.results.length) return page.results
  const alternatives = await browseGutenberg({ query: normalized, lang: "all" })
  return alternatives.results.map(book => ({ ...book, requestedLanguage: language, languageMatch: classifyLanguage(book, language) }))
}

// ── DESCARGAR TEXTO COMPLETO ─────────────────────────────
export async function downloadBookText(book: GutenbergBook): Promise<string> {
  const textUrl = plainTextUrl(book)
  if (!textUrl) {
    if (Object.keys(book.formats).some(mime => mime.startsWith("text/plain"))) {
      throw new Error("La fuente del texto no pertenece a Project Gutenberg")
    }
    throw new Error("No hay versión de texto plano disponible para este libro")
  }
  const buffer = await fetchBytes(textUrl, 12_000_000, 20_000)
  if (!buffer) throw new GutenbergSourceError("El archivo del libro ya no está disponible en Gutenberg.")
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer) }
  catch { return decodeWindows1252(buffer) }
}

// ── LIMPIAR TEXTO DE GUTENBERG ───────────────────────────
export function cleanGutenbergText(raw: string): string {
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  // Official markers follow a licence/metadata preamble; they are not at byte 0.
  // Match entire lines so a quotation in the novel cannot truncate its body.
  const start = /^\s*\*\*\*\s*(?:START OF (?:THE|THIS) PROJECT GUTENBERG|(?:COMIENZO|INICIO) DEL? (?:ESTE )?(?:PROYECTO )?GUTENBERG)[^\n]*\*\*\*[^\S\n]*$/im.exec(text)
  if (start) text = text.slice(start.index + start[0].length)
  const end = /^\s*(?:\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*|\*\*\*\s*FIN DEL? (?:PROYECTO )?GUTENBERG[^\n]*)$/im.exec(text)
  if (end) text = text.slice(0, end.index)
  // Preserve notes, captions, poetry, short sections and internal line breaks.
  return text.trim()
}

// ── DETECTAR Y DIVIDIR CAPÍTULOS ─────────────────────────
export function detectChapters(
  text: string, language = "es"
): { title: string; content: string }[] {

  const chapterPatterns = [
    // Written numbers and unaccented headings also occur in older editions.
    /^(?:cap[ií]tulo|capitolo|chapter|chapitre|canto|chant|parte?|libro|book|act[oe]?|scene|escena|jornada)\s+[\p{L}\p{N}]+[^\n]{0,60}$/iu,
    // Español
    /^(CAPÍTULO\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Capítulo\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(CANTO\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Canto\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(PARTE\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Parte\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(LIBRO\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Libro\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(ACTO\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Acto\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(ESCENA\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Escena\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(JORNADA\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    // Inglés
    /^(CHAPTER\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Chapter\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(BOOK\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Book\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(PART\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Part\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(ACT\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(SCENE\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    // Francés
    /^(CHAPITRE\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Chapitre\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(CHANT\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(ACTE\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    // Alemán
    /^(KAPITEL\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Kapitel\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    // Italiano / Portugués
    /^(CAPITOLO\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    /^(Capitolo\s+[IVXLCDM\d]+[^\n]{0,60})$/m,
    // Ruso, árabe, neerlandés, polaco, finés, sueco, latín y griego
    /^(ГЛАВА\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(الفصل\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(HOOFDSTUK\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(ROZDZIAŁ\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(LUKU\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(KAPITEL\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(CAPUT\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    /^(ΚΕΦΑΛΑΙΟ\s+[\p{L}\p{N}]+[^\n]{0,60})$/imu,
    // Japonés y chino: 第1章, 第一章, 第1节
    /^(第\s*[一二三四五六七八九十百千\d]+\s*[章节節回][^\n]{0,60})$/mu,
    // Numerales
    /^([IVXLCDM]{1,6}\.?\s*)$/m,
    /^([IVXLCDM]{1,6}\s*[-–—]\s*[^\n]{2,50})$/m,
    /^(\d{1,3}\.\s{1,3}[^\n]{3,60})$/m,
    /^(\d{1,3}\s*[-–—]\s*[^\n]{2,50})$/m,
  ]

  const lines = text.split("\n")
  const starts: { index: number; title: string }[] = []
  // Leave capacity for opening pages and oversized sections in the editor's 500-slot schema.
  for (let index = 0; index < lines.length && starts.length < 480; index++) {
    const title = lines[index].trim()
    if (!title || title.length > 80) continue
    const matches = chapterPatterns.some(pattern => pattern.test(title))
    // Isolated numerals can also be dialogue or table entries. Require space.
    const bareNumber = /^[IVXLCDM\d]+\.?$/.test(title)
    if (matches && (!bareNumber || (index === 0 || !lines[index - 1].trim())
      && (index + 1 === lines.length || !lines[index + 1].trim()))) {
      starts.push({ index, title })
    }
  }

  const labels: Record<string, [string, string]> = {
    es: ["Texto completo", "Páginas iniciales"], en: ["Full text", "Opening pages"],
    fr: ["Texte intégral", "Pages liminaires"], de: ["Volltext", "Anfangsseiten"],
    it: ["Testo completo", "Pagine iniziali"], pt: ["Texto completo", "Páginas iniciais"],
    ja: ["全文", "冒頭"], zh: ["全文", "开篇"], ar: ["النص الكامل", "الصفحات الأولى"],
    ru: ["Полный текст", "Начальные страницы"], nl: ["Volledige tekst", "Beginpagina’s"],
    pl: ["Pełny tekst", "Strony początkowe"], fi: ["Koko teksti", "Alkusivut"],
    sv: ["Hela texten", "Inledande sidor"], la: ["Textus integer", "Paginae initiales"],
    el: ["Πλήρες κείμενο", "Αρχικές σελίδες"],
  }
  const [fullText, opening] = labels[language] || labels.en
  if (starts.length < 2) return [{ title: fullText, content: text }]
  const chapters: { title: string; content: string }[] = []
  const prefix = lines.slice(0, starts[0].index).join("\n").trim()
  if (prefix) chapters.push({ title: opening, content: prefix })
  for (let i = 0; i < starts.length; i++) {
    const { index, title } = starts[i]
    const content = lines.slice(index + 1, starts[i + 1]?.index ?? lines.length).join("\n").trim()
    // An empty heading is retained with the following section, not discarded.
    if (!content) {
      const next = starts[i + 1]
      if (next) next.title = title + " · " + next.title
      else chapters.push({ title, content: title })
    } else chapters.push({ title, content })
  }
  return chapters.length ? chapters : [{ title: fullText, content: text }]
}

export function fitGutenbergChapters(chapters: { title: string; content: string }[]) {
  const output: { title: string; content: string }[] = []
  for (const chapter of chapters) {
    // Keep long sequences of index headings in the text, rather than truncating them.
    let content = chapter.title.length > 200 ? chapter.title + "\n\n" + chapter.content : chapter.content
    const title = chapter.title.slice(0, 180)
    let part = 1
    while (content.length > 2_000_000) {
      const paragraph = content.lastIndexOf("\n\n", 1_900_000)
      let end = paragraph > 950_000 ? paragraph : 1_900_000
      if (/[\uD800-\uDBFF]/.test(content[end - 1])) end--
      output.push({ title: `${title} · ${part++}`, content: content.slice(0, end) })
      content = content.slice(end)
    }
    output.push({ title: part > 1 ? `${title} · ${part}` : title, content })
  }
  return output
}

// ── DETECTAR GÉNERO ───────────────────────────────────────
export function detectGenre(book: GutenbergBook): string {
  const subjects = book.subjects.map(s => s.toLowerCase()).join(" ")

  const patterns: [RegExp, string][] = [
    [/horror|terror|ghost|supernatural|haunted|espanto|fantasma|sobrenatural|miedo/, "terror"],
    [/love stories|romance|courtship|marriage|amor|romance|cortejo|matrimonio/,       "romance"],
    [/science fiction|fantasy|imaginary|utopia|future|ficción|fantasía|ciencia ficción/, "fantasia"],
    [/detective|mystery|crime|police|misterio|detectives|crimen|policial/,            "misterio"],
    [/philosophy|existential|psychology|tragedy|death|filosofía|existencial|tragedia/, "melancolico"],
    [/epic|mythology|legend|hero|mito|leyenda|épica|epopeya/,                         "fantasia"],
  ]

  for (const [pattern, genre] of patterns) {
    if (pattern.test(subjects)) return genre
  }
  return ""
}

// Gutenberg summaries belong to this exact edition. Do not attach an unrelated
// Google Books/Open Library description or infer its language from the novel.
function synopsisFor(book: GutenbergBook): Pick<ProcessedBook, "synopsis" | "synopsisSource" | "synopsisLanguage"> {
  const synopsis = book.summaries?.find(summary => summary.trim())
  if (synopsis) return { synopsis: synopsis.trim().slice(0, 8_000), synopsisSource: "gutendex", synopsisLanguage: null }
  return {
    synopsis: [book.title, book.authors.map(person => normalizeAuthorName(person.name)).join(" · "),
      book.subjects.slice(0, 4).join(" · ")].filter(Boolean).join("\n"),
    synopsisSource: "metadata", synopsisLanguage: null,
  }
}

// ── TRADUCIR CON LIBRETRANSLATE ───────────────────────────
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  if (!text || sourceLang === targetLang) return text

  // Google Translate API informal — sin API key, muy confiable
  // Funciona leyendo la respuesta del endpoint de traducción público
  try {
    const encoded = encodeURIComponent(text)
    const url     = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encoded}`
    const res     = await fetchWithTimeout(url, 8000)
    if (!res.ok) throw new Error("Google Translate failed")
    const data    = await res.json()
    // Respuesta: [[["traducción","original",null,null,1],...],...]
    if (Array.isArray(data?.[0])) {
      const translated = data[0]
        .filter((part: any) => Array.isArray(part) && part[0])
        .map((part: any) => part[0])
        .join("")
      if (typeof translated === "string" && translated.trim()) return translated
    }
  } catch { /* fallback silencioso */ }

  // Fallback: MyMemory API (gratuita, sin key)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 400))}&langpair=${sourceLang}|${targetLang}`
    const res = await fetchWithTimeout(url, 6000)
    if (res.ok) {
      const data = await res.json()
      const t    = data?.responseData?.translatedText
      if (t && t !== "PLEASE SELECT TWO DISTINCT LANGUAGES") return t
    }
  } catch {}

  return text // devolver original si todo falla
}

// Gutenberg does not expose the original print publication year. Years inside
// subjects describe settings/periods, not necessarily publication.
export function detectPublicationYear(_book: GutenbergBook): number | null { return null }

// ── NORMALIZAR NOMBRE DE AUTOR ────────────────────────────
function normalizeAuthorName(raw: string): string {
  if (!raw) return "Anónimo"
  if (raw.includes(",")) {
    return raw.split(",").map(p => p.trim()).reverse().join(" ")
  }
  return raw
}

export function countGutenbergWords(text: string): number {
  // Whitespace alone reports one word for entire Chinese/Japanese paragraphs.
  const spaced = text.replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, " $1 ")
  let count = 0
  for (const _match of spaced.matchAll(/\S+/gu)) count++
  return count
}

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────

export async function processGutenbergBook(book: GutenbergBook, _userLang = "es"): Promise<ProcessedBook> {
  if (!isGutenbergBook(book)) throw new Error("Metadatos del libro inválidos")
  if (book.copyright !== false) throw new Error("Esta edición no está habilitada para importar desde Gutenberg.")
  return processedCache.get(String(book.id), async () => {
    const rawText = await downloadBookText(book)
    if (/^\s*(?:<!doctype html|<html[\s>])/i.test(rawText)) throw new GutenbergSourceError("Gutenberg devolvió una página web en lugar del texto.")
    const cleanText = cleanGutenbergText(rawText)
    if (!cleanText) throw new GutenbergSourceError("El archivo de Gutenberg no contiene texto legible.")
    const bookLang = book.languages[0] || "und"
    const detected = detectChapters(cleanText, bookLang)
    const chapters = fitGutenbergChapters(detected)
    const wordCount = countGutenbergWords(cleanText)
    return {
      gutenbergId: book.id, title: book.title,
      author: book.authors.map(person => normalizeAuthorName(person.name)).join(" · ") || "—",
      ...synopsisFor(book), coverUrl: gutenbergCover(book),
      originalLanguage: bookLang, languages: book.languages,
      translators: (book.translators || []).map(person => normalizeAuthorName(person.name)),
      publicationYear: null, chapters, detectedGenre: detectGenre(book), wordCount,
      readingMinutes: Math.max(1, Math.ceil(wordCount / 230)),
      chapterStrategy: detected.length > 1 ? "headings" : "full-text",
      type: wordCount < 8000 ? "story" : "book",
      sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
    }
  })
}
