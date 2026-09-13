// Shared catalogue contract; no server code or validation bundle in the reader.
export const GUTENBERG_LANGUAGES = [
  ["es", "Español"], ["en", "English"], ["fr", "Français"], ["de", "Deutsch"],
  ["it", "Italiano"], ["pt", "Português"], ["ru", "Русский"], ["ja", "日本語"],
  ["zh", "中文"], ["ar", "العربية"], ["nl", "Nederlands"], ["pl", "Polski"],
  ["fi", "Suomi"], ["sv", "Svenska"], ["la", "Latina"], ["el", "Ελληνικά"],
] as const

export const GUTENBERG_TOPICS = ["", "fiction", "adventure", "mystery", "fantasy", "poetry", "philosophy", "children"] as const
export type GutenbergTopic = typeof GUTENBERG_TOPICS[number]
export type GutenbergSort = "popular" | "descending" | "ascending"
export type GutenbergPerson = { name: string; birth_year: number | null; death_year: number | null }
export interface GutenbergBook {
  id: number
  title: string
  authors: GutenbergPerson[]
  translators?: GutenbergPerson[]
  languages: string[]
  subjects: string[]
  bookshelves?: string[]
  summaries?: string[]
  formats: Record<string, string>
  download_count: number
  copyright?: boolean | null
  media_type?: string
  requestedLanguage?: string
  languageMatch?: "exact" | "multilingual" | "alternative"
  coverUrl?: string
  existingBookId?: number | null
  alreadyImported?: boolean
  existingStatus?: string
}
export interface GutenbergCatalogPage {
  count: number
  page: number
  nextPage: number | null
  previousPage: number | null
  results: GutenbergBook[]
  query: string
  language: string
  sort: GutenbergSort
  topic: GutenbergTopic
}
export interface ProcessedGutenbergBook {
  gutenbergId: number
  title: string
  author: string
  synopsis: string
  synopsisSource: "gutendex" | "metadata"
  synopsisLanguage: string | null
  coverUrl: string
  originalLanguage: string
  languages: string[]
  translators: string[]
  publicationYear: number | null
  chapters: { title: string; content: string }[]
  detectedGenre: string
  wordCount: number
  readingMinutes: number
  chapterStrategy: "headings" | "full-text"
  type: "book" | "story"
  sourceUrl: string
}
export type GutenbergPreview = ProcessedGutenbergBook & {
  chapterCount: number
  previewText: string
  existingBookId?: number | null
  alreadyImported?: boolean
}

export function gutenbergIdFromQuery(query: string): number | null {
  const text = query.trim()
  const numeric = text.match(/^#?(\d{1,9})$/)
  if (numeric) return Number(numeric[1]) || null
  try {
    const url = new URL(text)
    if (url.protocol !== "https:" || !["gutenberg.org", "www.gutenberg.org"].includes(url.hostname)
      || url.username || url.password || url.port) return null
    const match = url.pathname.match(/^\/ebooks\/(\d{1,9})\/?$/)
    return match ? Number(match[1]) || null : null
  } catch { return null }
}

export function gutenbergLanguageName(code: string): string {
  return GUTENBERG_LANGUAGES.find(([value]) => value === code)?.[1] || code.toUpperCase()
}
