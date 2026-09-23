import type { Express, Request, RequestHandler, Response } from "express"
import { z } from "zod"
import type { IStorage } from "./storage"
import { GUTENBERG_TOPICS } from "../shared/gutenberg"
import { browseGutenberg, fetchGutenbergBookById, normalizeGutenbergLanguage, processGutenbergBook, searchGutenberg,
  GutenbergSourceError } from "./gutenberg"
import { GutenbergBusyError } from "./gutenberg-cache"

const catalogInput = z.object({
  q: z.string().trim().max(120).default(""),
  lang: z.string().max(12).default("es"),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  sort: z.enum(["popular", "descending", "ascending"]).default("popular"),
  topic: z.enum(GUTENBERG_TOPICS).default(""),
})
export const gutenbergImportSchema = z.object({
  gutenbergId: z.coerce.number().int().positive().max(999_999_999),
  genre: z.string().trim().max(60).optional().default(""),
  overrideTitle: z.string().trim().max(200).optional().default(""),
  overrideSynopsis: z.string().trim().max(8_000).optional().default(""),
  lang: z.string().trim().toLowerCase().max(12).optional().default("es"),
  status: z.enum(["draft", "published"]).default("published"),
}).strict()

type Dependencies = {
  storage: Pick<IStorage, "getGutenbergReferences" | "findBookByGutenbergId" | "getBook" | "createBook">
  requireAdmin: RequestHandler
  isAdmin: (user: unknown) => boolean
  rateLimit: (window: number, maximum: number) => RequestHandler
}

function sendError(res: Response, error: unknown) {
  if (error instanceof GutenbergSourceError || error instanceof GutenbergBusyError) {
    res.setHeader("Retry-After", "10")
    return res.status(503).json({ message: error.message, code: "GUTENBERG_UNAVAILABLE" })
  }
  console.error("Gutenberg:", error instanceof Error ? error.message : "Error")
  return res.status(500).json({ message: "No se pudo procesar el libro. Inténtalo de nuevo.", code: "GUTENBERG_ERROR" })
}

export function registerGutenbergRoutes(app: Express, { storage, requireAdmin, isAdmin, rateLimit }: Dependencies) {
  const enrich = async <T extends { id: number }>(results: T[], admin: boolean) => {
    const rows = await storage.getGutenbergReferences(results.map(book => book.id), admin)
    const byId = new Map(rows.map(row => [row.gutenbergId, row]))
    return results.map(book => {
      const existing = byId.get(book.id)
      return { ...book, alreadyImported: !!existing, existingBookId: existing?.id ?? null,
        ...(admin && existing ? { existingStatus: existing.status } : {}) }
    })
  }

  app.get("/api/gutenberg/catalog", rateLimit(60_000, 30), async (req, res) => {
    const parsed = catalogInput.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: "Filtros de Gutenberg inválidos" })
    try {
      const { q, ...options } = parsed.data
      const result = await browseGutenberg({ ...options, query: q })
      res.setHeader("Cache-Control", "private, no-store") // Import status depends on role and database.
      return res.json({ ...result, results: await enrich(result.results, isAdmin(req.user)) })
    } catch (error) { return sendError(res, error) }
  })

  const search: RequestHandler = async (req, res) => {
    const parsed = catalogInput.safeParse(req.query)
    if (!parsed.success || !parsed.data.q) return res.status(400).json({ message: "Falta el parámetro q" })
    try {
      const results = await searchGutenberg(parsed.data.q, parsed.data.lang)
      return res.json(await enrich(results, req.path.startsWith("/api/admin/") && isAdmin(req.user)))
    } catch (error) { return sendError(res, error) }
  }
  app.get("/api/gutenberg/search", rateLimit(60_000, 20), search)
  app.get("/api/admin/gutenberg/search", requireAdmin, rateLimit(60_000, 20), search)

  async function preview(req: Request, res: Response, admin: boolean) {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0 || id > 999_999_999) return res.status(400).json({ message: "ID inválido" })
    try {
      if (!admin) {
        const [existing] = await storage.getGutenbergReferences([id])
        if (existing) return res.json({ ...await storage.getBook(existing.id), existingBookId: existing.id, alreadyImported: true })
      }
      const book = await fetchGutenbergBookById(id)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.copyright !== false) return res.status(422).json({ message: "Esta edición no está habilitada para importar." })
      const processed = await processGutenbergBook(book, normalizeGutenbergLanguage(String(req.query.lang || "es")))
      return res.json({ ...processed, chapterCount: processed.chapters.length,
        previewText: (processed.chapters[0]?.content || "").slice(0, 1_600),
        existingBookId: null, alreadyImported: false,
        ...(admin ? { chapters: processed.chapters.map(chapter => ({ title: chapter.title, wordCount: chapter.content.split(/\s+/).length })) } : {}),
      })
    } catch (error) { return sendError(res, error) }
  }
  app.get("/api/gutenberg/preview/:id", rateLimit(60_000, 6), (req, res) => preview(req, res, false))
  app.get("/api/admin/gutenberg/preview/:id", requireAdmin, rateLimit(60_000, 6), (req, res) => preview(req, res, true))

  app.post("/api/admin/gutenberg/import", requireAdmin, rateLimit(60_000, 6), async (req, res) => {
    const parsed = gutenbergImportSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: "Datos de importación inválidos" })
    const { gutenbergId, genre, overrideTitle, overrideSynopsis, lang, status } = parsed.data
    try {
      const existing = await storage.findBookByGutenbergId(gutenbergId)
      if (existing) return res.status(409).json({ message: "Este libro ya está importado", existingBookId: existing.id, existingStatus: existing.status })
      const source = await fetchGutenbergBookById(gutenbergId)
      if (!source) return res.status(404).json({ message: "Libro no encontrado en Gutenberg" })
      if (source.copyright !== false) return res.status(422).json({ message: "Esta edición no está habilitada para importar." })
      const processed = await processGutenbergBook(source, lang)
      const book = await storage.createBook({
        title: overrideTitle || processed.title.slice(0, 200), author: processed.author.slice(0, 160),
        synopsis: overrideSynopsis || processed.synopsis, coverUrl: processed.coverUrl,
        genre: genre || processed.detectedGenre, type: processed.type, status, isClassic: true,
        publicationYear: processed.publicationYear, originalLanguage: processed.originalLanguage,
        gutenbergId, chapters: processed.chapters, content: "", isSaved: false, isAuthored: false,
      })
      return res.status(201).json({ book, stats: { chapters: processed.chapters.length, wordCount: processed.wordCount, genre: processed.detectedGenre } })
    } catch (error: any) {
      const databaseError = error?.cause || error
      if (databaseError?.code === "23505" && String(databaseError?.constraint || "").includes("gutenberg")) {
        return res.status(409).json({ message: "Este libro ya está importado" })
      }
      return sendError(res, error)
    }
  })
}
