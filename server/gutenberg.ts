// ── IMPORTADOR DE PROJECT GUTENBERG ──────────────────────
// Google Books API   → sinopsis editorial de calidad (prioridad 1)
// Open Library       → descripción como respaldo (prioridad 2)
// Gutendex subjects  → descripción generada como último recurso
// Gutendex           → búsqueda y texto completo
// LibreTranslate     → traducción de sinopsis cuando difiere el idioma

function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") || 0)
  if (declared > maxBytes) throw new Error("El texto excede el tamaño permitido")
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) throw new Error("El texto excede el tamaño permitido")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
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

// ── INTERFACES ───────────────────────────────────────────
export interface GutenbergBook {
  id:            number
  title:         string
  authors:       { name: string; birth_year: number | null; death_year: number | null }[]
  languages:     string[]
  subjects:      string[]
  formats:       Record<string, string>
  download_count: number
  requestedLanguage?: string
  languageMatch?: "exact" | "multilingual" | "alternative"
}

interface GutenbergSearchResult {
  count:   number
  results: GutenbergBook[]
}

function isGutenbergBook(value: unknown): value is GutenbergBook {
  if (!value || typeof value !== "object") return false
  const book = value as Partial<GutenbergBook>
  return Number.isInteger(book.id)
    && (book.id as number) > 0
    && typeof book.title === "string"
    && book.title.length > 0
    && book.title.length <= 1_000
    && Array.isArray(book.languages)
    && Array.isArray(book.authors)
    && Array.isArray(book.subjects)
    && !!book.formats
    && typeof book.formats === "object"
}

export async function fetchGutenbergBookById(id: number): Promise<GutenbergBook | null> {
  if (!Number.isInteger(id) || id <= 0) return null
  const response = await fetchWithTimeout(`https://gutendex.com/books/${id}`, 9_000, { redirect: "error" })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Gutendex respondió ${response.status}`)
  const raw = new TextDecoder().decode(await readBodyWithLimit(response, 1_500_000))
  const value = JSON.parse(raw) as Partial<GutenbergBook>
  if (value.id !== id || typeof value.title !== "string" || !Array.isArray(value.languages)
      || !Array.isArray(value.authors) || !Array.isArray(value.subjects)
      || !value.formats || typeof value.formats !== "object") {
    throw new Error("Gutendex devolvió metadatos inválidos")
  }
  return value as GutenbergBook
}

export interface ProcessedBook {
  gutenbergId:      number
  title:            string
  author:           string
  synopsis:         string
  coverUrl:         string
  originalLanguage: string
  publicationYear:  number | null
  chapters:         { title: string; content: string }[]
  detectedGenre:    string
  wordCount:        number
  type:             "book" | "story"
}

// ── IDIOMAS SOPORTADOS ───────────────────────────────────
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  es: "Español",  en: "Inglés",   fr: "Francés",
  de: "Alemán",   it: "Italiano", pt: "Portugués",
  ru: "Ruso",     ja: "Japonés",  zh: "Chino",
  ar: "Árabe",    nl: "Holandés", pl: "Polaco",
  fi: "Finlandés",sv: "Sueco",    la: "Latín",
  el: "Griego",
}

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

function plainTextUrl(book: GutenbergBook): string | undefined {
  return Object.entries(book.formats).find(([mime, value]) =>
    mime.toLowerCase().startsWith("text/plain") && typeof value === "string" && value.length > 0
  )?.[1]
}

function classifyLanguage(book: GutenbergBook, requestedLanguage: string): GutenbergBook["languageMatch"] {
  const languages = book.languages.map(language =>
    String(language || "").trim().toLowerCase().split(/[-_]/)[0]
  ).filter(Boolean)
  if (!languages.includes(requestedLanguage)) return "alternative"
  return languages.length > 1 ? "multilingual" : "exact"
}

// ── BÚSQUEDA EN GUTENDEX — con fuzzy fallback ────────────
export async function searchGutenberg(
  query: string,
  lang = "es"
): Promise<GutenbergBook[]> {
  const cleanQuery = String(query || "").trim().slice(0, 120)
  if (!cleanQuery) return []
  const normalized = normalizeQuery(cleanQuery)
  const requestedLanguage = normalizeGutenbergLanguage(lang)
  const seen       = new Set<number>()
  const results:   GutenbergBook[] = []

  // Función de búsqueda individual
  async function fetchBooks(q: string, language?: string): Promise<GutenbergBook[]> {
    const url = new URL("https://gutendex.com/books/")
    url.searchParams.set("search", q)
    // Gutendex compara el inicio del MIME. "text/" excluye imágenes y EPUB
    // sin depender de la presencia accidental de la palabra "text".
    url.searchParams.set("mime_type", "text/")
    if (language) url.searchParams.set("languages", language)
    try {
      const res = await fetchWithTimeout(url.toString(), 9000, { redirect: "error" })
      if (!res.ok) return []
      const raw = new TextDecoder().decode(await readBodyWithLimit(res, 1_500_000))
      const data = JSON.parse(raw) as Partial<GutenbergSearchResult>
      return Array.isArray(data.results)
        ? data.results.filter(isGutenbergBook).filter(book => !!plainTextUrl(book)).slice(0, 24)
        : []
    } catch { return [] }
  }

  const addBooks = (books: GutenbergBook[], allowAlternatives: boolean) => {
    for (const book of books) {
      if (seen.has(book.id)) continue
      const languageMatch = classifyLanguage(book, requestedLanguage)
      if (!allowAlternatives && languageMatch === "alternative") continue
      seen.add(book.id)
      results.push({ ...book, requestedLanguage, languageMatch })
    }
  }

  // Búsqueda 1: query original con idioma
  addBooks(await fetchBooks(cleanQuery, requestedLanguage), false)

  // Búsqueda 2: query normalizado (sin tildes) con idioma
  if (normalized && normalized !== cleanQuery.toLowerCase()) {
    addBooks(await fetchBooks(normalized, requestedLanguage), false)
  }

  // Solo si no existe ninguna edición en el idioma solicitado, mostrar otras
  // ediciones. Nunca se mezclan silenciosamente con coincidencias exactas.
  if (results.length === 0) {
    addBooks(await fetchBooks(normalized || cleanQuery), true)
  }

  return results.slice(0, 12)
}

// ── DESCARGAR TEXTO COMPLETO ─────────────────────────────
export async function downloadBookText(book: GutenbergBook): Promise<string> {
  const formats = book.formats
  const textUrl =
    formats["text/plain; charset=utf-8"]      ||
    formats["text/plain; charset=us-ascii"]   ||
    formats["text/plain; charset=iso-8859-1"] ||
    formats["text/plain"]                     ||
    Object.entries(formats).find(([k]) => k.startsWith("text/plain"))?.[1]

  if (!textUrl) throw new Error("No hay versión de texto plano disponible para este libro")

  // Gutendex aporta la URL, pero nunca dejamos que una respuesta externa
  // convierta el importador en un proxy hacia la red interna.
  let parsedTextUrl: URL
  try { parsedTextUrl = new URL(textUrl) }
  catch { throw new Error("La URL del texto de Gutenberg no es válida") }
  const host = parsedTextUrl.hostname.toLowerCase()
  if (parsedTextUrl.protocol !== "https:" || (host !== "gutenberg.org" && !host.endsWith(".gutenberg.org"))) {
    throw new Error("La fuente del texto no pertenece a Project Gutenberg")
  }

  // No seguir redirecciones: validar solo el primer host no basta si éste
  // pudiera redirigir la petición hacia una dirección interna.
  const res = await fetchWithTimeout(parsedTextUrl.toString(), 12000, { redirect: "error" })
  if (!res.ok) throw new Error(`Error descargando texto: ${res.status}`)

  const buffer = await readBodyWithLimit(res, 12_000_000)
  try {
    // TextDecoder sin fatal=true reemplaza bytes inválidos silenciosamente,
    // por lo que el respaldo para libros antiguos nunca llegaba a ejecutarse.
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return decodeWindows1252(buffer)
  }
}

// ── LIMPIAR TEXTO DE GUTENBERG ───────────────────────────
export function cleanGutenbergText(raw: string): string {
  let text = raw

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  // Eliminar marcadores de inicio de Gutenberg
  const startMarkers = [
    /^\s*\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG.*?\*\*\*\s*/is,
    /^\s*\*\*\*\s*COMIENZO DE(L)? (ESTE )?(PROYECTO )?GUTENBERG.*?\*\*\*\s*/is,
    /^\s*\*\*\*\s*INICIO DE(L)?.+?\*\*\*\s*/is,
  ]
  for (const p of startMarkers) {
    if (p.test(text)) { text = text.replace(p, ""); break }
  }

  // Eliminar bloque de metadata al inicio
  if (!text.match(/^(CAPÍTULO|Chapter|CHAPTER|Capítulo|I\.|II\.|III\.)/m)) {
    const metaLines = [
      /^The Project Gutenberg (eBook|EBook|Ebook).*/i,
      /^This (ebook|eBook|EBook) is for the use.*/i,
      /^Title:/i, /^Author:/i, /^Translator:/i, /^Editor:/i,
      /^Illustrator:/i, /^Release (date|Date):/i, /^Language:/i,
      /^Credits:/i, /^Produced by/i, /^Transcribed by/i,
      /^\[?Transcription/i, /^Character set encoding:/i,
      /^\*\*\* (START|END)/i, /^START OF THE PROJECT/i,
      /University of/i, /Internet Archive/i, /pgdp\.net/i,
      /distributed proofreading/i, /^\(This file was/i,
      /^from images/i, /^generously made available/i,
      /^American Libraries/i, /http[s]?:\/\//,
    ]
    const lines = text.split("\n")
    let contentStart = 0
    let consecutiveEmpty = 0

    for (let i = 0; i < Math.min(lines.length, 120); i++) {
      const line = lines[i].trim()
      if (!line) {
        consecutiveEmpty++
        if (consecutiveEmpty >= 3 && i > 10) { contentStart = i + 1; break }
        continue
      }
      consecutiveEmpty = 0
      if (metaLines.some(p => p.test(line))) contentStart = i + 1
    }

    if (contentStart > 5) text = lines.slice(contentStart).join("\n")
  }

  // Eliminar footer de Gutenberg
  const endMarkers = [
    /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG.*/is,
    /\*\*\*\s*FIN DE(L)?.*/is,
    /End of (the )?Project Gutenberg.*/is,
  ]
  for (const p of endMarkers) text = text.replace(p, "")

  // Eliminar notas del transcriptor
  text = text.replace(/\[Nota del transcriptor:.*?\]/gis, "")
  text = text.replace(/\[Transcriber's Note:.*?\]/gis, "")

  // ── ELIMINAR ETIQUETAS DE ILUSTRACIÓN ────────────────
  // Gutenberg marca imágenes con [Ilustración] o [Ilustración: descripción]
  // ya que el formato plano no puede incluir imágenes reales
  text = text.replace(/\[Ilustración[^\]]*\]/gi, "")
  text = text.replace(/\[Illustration[^\]]*\]/gi, "")
  text = text.replace(/\[Illus\.[^\]]*\]/gi, "")
  text = text.replace(/\[Imagen[^\]]*\]/gi, "")
  text = text.replace(/\[Figure[^\]]*\]/gi, "")
  text = text.replace(/\[Fig\.[^\]]*\]/gi, "")

  // Normalizar espaciado
  text = text.replace(/\n{4,}/g, "\n\n\n")

  return text.trim()
}

// ── DETECTAR ÍNDICE VS CAPÍTULO REAL ─────────────────────
// Muchos libros de Gutenberg tienen un índice al inicio que se
// confunde con el primer capítulo. Un índice se caracteriza por
// tener muchas líneas muy cortas (< 60 chars) con números.
function isIndexContent(content: string): boolean {
  const lines = content.split("\n").filter(l => l.trim().length > 0)
  if (lines.length < 3) return false

  // Contar líneas que terminan en número (típico de índice con páginas)
  const linesWithNumbers = lines.filter(l => /\d+\s*$/.test(l.trim())).length
  const shortLines       = lines.filter(l => l.trim().length < 60).length

  // Si más del 50% de líneas terminan en número Y son cortas → es índice
  const ratio = linesWithNumbers / lines.length
  return ratio > 0.4 && shortLines / lines.length > 0.5
}

// ── DETECTAR Y DIVIDIR CAPÍTULOS ─────────────────────────
export function detectChapters(
  text: string
): { title: string; content: string }[] {

  const chapterPatterns = [
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
    /^(第\s*[一二三四五六七八九十百千\d]+\s*[章节][^\n]{0,60})$/mu,
    // Numerales
    /^([IVXLCDM]{1,6}\.?\s*)$/m,
    /^([IVXLCDM]{1,6}\s*[-–—]\s*[^\n]{2,50})$/m,
    /^(\d{1,3}\.\s{1,3}[^\n]{3,60})$/m,
    /^(\d{1,3}\s*[-–—]\s*[^\n]{2,50})$/m,
  ]

  const lines = text.split("\n")
  const chapterStarts: { index: number; title: string }[] = []

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length > 80) return
    if (chapterStarts.length >= 500) return

    for (const pattern of chapterPatterns) {
      if (pattern.test(trimmed)) {
        chapterStarts.push({ index: i, title: trimmed })
        break
      }
    }
  })

  if (chapterStarts.length >= 2) {
    const rawChapters: { title: string; content: string }[] = []

    for (let i = 0; i < chapterStarts.length; i++) {
      const start   = chapterStarts[i].index + 1
      const end     = i + 1 < chapterStarts.length ? chapterStarts[i+1].index : lines.length
      const content = lines.slice(start, end).join("\n").trim()
      if (content.length > 200) {
        rawChapters.push({ title: chapterStarts[i].title, content })
      }
    }

    // Filtrar capítulos que sean índices
    const realChapters = rawChapters.filter(c => !isIndexContent(c.content))

    if (realChapters.length >= 2) return realChapters
    if (rawChapters.length >= 2) return rawChapters
  }

  return [{ title: "Texto completo", content: text }]
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

// ── SINOPSIS: GOOGLE BOOKS API (PRIORIDAD 1) ─────────────
// Descripciones editoriales reales, múltiples idiomas, sin API key
async function fetchSynopsisFromGoogleBooks(
  title: string,
  author: string,
  langCode: string
): Promise<string> {
  try {
    // Intentar primero en el idioma del usuario
    const langs = langCode !== "en" ? [langCode, "en"] : ["en"]

    for (const lang of langs) {
      const query = encodeURIComponent(`${title} ${author}`)
      const url   = `https://www.googleapis.com/books/v1/volumes?q=${query}&langRestrict=${lang}&maxResults=3&fields=items(volumeInfo(title,description,language))`

      const res = await fetchWithTimeout(url, 8000)
      if (!res.ok) continue

      const data  = await res.json()
      const items = data.items || []

      for (const item of items) {
        const desc = item.volumeInfo?.description
        if (desc && desc.length > 60 && desc.length < 1200) {
          // Verificar que no es metadata técnica
          if (/gutenberg|proofreading|copyright notice/i.test(desc)) continue
          // Truncar si es muy largo
          return desc.length > 500 ? desc.slice(0, 500) + "…" : desc
        }
      }
    }
    return ""
  } catch {
    return ""
  }
}

// ── SINOPSIS: OPEN LIBRARY (PRIORIDAD 2) ─────────────────
async function fetchSynopsisFromOpenLibrary(
  title: string,
  author: string
): Promise<string> {
  try {
    const query = encodeURIComponent(`${title} ${author}`)
    const res   = await fetchWithTimeout(
      `https://openlibrary.org/search.json?q=${query}&limit=1&fields=key,title,description,first_sentence`,
      8000
    )
    if (!res.ok) return ""

    const data = await res.json()
    const doc  = data.docs?.[0]

    // Preferir description completa sobre first_sentence
    const desc = doc?.description?.value || doc?.description
    if (desc && typeof desc === "string" && desc.length > 60) {
      if (!/gutenberg|proofreading/i.test(desc)) {
        return desc.length > 450 ? desc.slice(0, 450) + "…" : desc
      }
    }

    // Fallback a first_sentence
    const fs = doc?.first_sentence?.value || doc?.first_sentence
    if (fs && typeof fs === "string" && fs.length > 40) {
      return fs.length > 400 ? fs.slice(0, 400) + "…" : fs
    }

    return ""
  } catch {
    return ""
  }
}

// ── SINOPSIS: DESDE SUBJECTS (PRIORIDAD 3) ───────────────
// Construir descripción editorial desde los metadatos del libro
function buildSynopsisFromMetadata(book: GutenbergBook): string {
  const author = normalizeAuthorName(book.authors[0]?.name || "")
  const year   = detectPublicationYear(book)

  // Filtrar subjects útiles (eliminar los técnicos y de clasificación)
  const usefulSubjects = book.subjects
    .filter(s => {
      const l = s.toLowerCase()
      return !l.includes("fiction") && !l.includes("--") &&
             s.length > 5 && s.length < 60
    })
    .slice(0, 3)

  const yearStr = year
    ? year < 0 ? `del año ${Math.abs(year)} a.C.`
      : `de ${year}`
    : ""

  const subjectStr = usefulSubjects.length > 0
    ? ` Abarca temas de ${usefulSubjects.join(", ").toLowerCase()}.`
    : ""

  if (author && author !== "Anónimo") {
    return `Obra clásica de ${author}${yearStr ? " " + yearStr : ""}.${subjectStr} Disponible en dominio público.`
  }

  return `Obra clásica${yearStr ? " " + yearStr : ""}.${subjectStr} Disponible en dominio público.`
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

// ── PORTADA DESDE OPEN LIBRARY ────────────────────────────
export async function fetchCoverFromOpenLibrary(
  title: string,
  author: string
): Promise<string> {
  try {
    const query = encodeURIComponent(`${title} ${author}`)
    const res   = await fetchWithTimeout(
      `https://openlibrary.org/search.json?q=${query}&limit=1&fields=cover_i`,
      8000
    )
    if (!res.ok) return ""
    const data    = await res.json()
    const coverId = data.docs?.[0]?.cover_i
    if (!coverId) return ""
    return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
  } catch {
    return ""
  }
}

// ── AÑO DE PUBLICACIÓN ────────────────────────────────────
export function detectPublicationYear(book: GutenbergBook): number | null {
  for (const subject of book.subjects) {
    const match = subject.match(/(\d{4})/)
    if (match) {
      const year = parseInt(match[1])
      if (year >= 1400 && year <= 1928) return year
    }
  }
  // La fecha de muerte o "nacimiento + 35" no es una fecha de publicación.
  // Es preferible mostrar el dato como desconocido que inventar metadatos.
  return null
}

// ── NORMALIZAR NOMBRE DE AUTOR ────────────────────────────
function normalizeAuthorName(raw: string): string {
  if (!raw) return "Anónimo"
  if (raw.includes(",")) {
    return raw.split(",").map(p => p.trim()).reverse().join(" ")
  }
  return raw
}

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────
export async function processGutenbergBook(
  book:         GutenbergBook,
  userLang = "es"
): Promise<ProcessedBook> {
  const bookLang   = book.languages[0] || "en"
  const authorName = normalizeAuthorName(book.authors[0]?.name || "")

  // 1. Descargar texto y portada en paralelo
  const [rawText, coverUrl] = await Promise.all([
    downloadBookText(book),
    fetchCoverFromOpenLibrary(book.title, authorName),
  ])
  const cleanText = cleanGutenbergText(rawText)

  // 2. Detectar capítulos
  const chapters = detectChapters(cleanText)

  // 3. Detectar género y año
  const genre     = detectGenre(book)
  const year      = detectPublicationYear(book)
  const wordCount = cleanText.split(/\s+/).length
  const type: "book" | "story" = wordCount < 8000 ? "story" : "book"

  // 4. Sinopsis — cascada de calidad
  //    Google Books (mejor) → Open Library → metadatos propios
  let synopsis = await fetchSynopsisFromGoogleBooks(book.title, authorName, userLang)

  if (!synopsis) {
    synopsis = await fetchSynopsisFromOpenLibrary(book.title, authorName)
  }

  if (!synopsis) {
    synopsis = buildSynopsisFromMetadata(book)
  }

  // 5. Traducir si la sinopsis está en idioma distinto al usuario
  if (synopsis && bookLang !== userLang && userLang !== "en") {
    const translated = await translateText(synopsis, bookLang, userLang)
    if (translated && translated !== synopsis) synopsis = translated
  }

  return {
    gutenbergId:      book.id,
    title:            book.title,
    author:           authorName,
    synopsis,
    coverUrl,
    originalLanguage: bookLang,
    publicationYear:  year,
    chapters,
    detectedGenre:    genre,
    wordCount,
    type,
  }
}
