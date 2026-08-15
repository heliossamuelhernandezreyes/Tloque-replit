import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { requireAdmin, isAdmin, refreshAdminCache, FOUNDER_EMAIL } from "./auth";
import { db } from "./db";
import { admins, books, users, comments, authorProfiles, userState, readingProgress, savedBooks, bookTokens, printCopies, printCopyEvents, notifications, unlockedBooks, tokenOrders, authorEarnings, walletLedger, walletOrders, paperUsageEvents, bookCards, userCards, frames, userFrames, gachaConfig, gachaPity, gachaDraws, insertCommentSchema } from "@shared/schema";
import { randomBytes, timingSafeEqual } from "crypto";
import { rateLimit } from "./rateLimit";
import {
  validateCard, MAX_CARDS_PER_BOOK, MAX_LOOSE_CARDS,
  CARD_PRICE_MIN, CARD_PRICE_MAX,
} from "./cards";
import { validateFrame } from "./frames";
import { drawTicket } from "./gachaEngine";
import { registerAudioRoutes } from "./audio";
import { registerNarrativeRoutes } from "./narrative";
import { registerSpeechRoutes } from "./speech";
import { computeAllScores, canUseRarity, quotasFor, rungFor, LADDER, TYPE_SCALE } from "./rarity";
import { RARITIES, TICKET, PITY, pityCountdown, poolStatus } from "@shared/gacha";
import { PRICES, TINTA_PACKS, TINTA_CENTS, AUTHOR_SHARE_STORY, AUTHOR_SHARE_BOOK, priceFor, isStory, stripeEnabled, betaPaymentsEnabled, createCheckoutSession, verifyStripeWebhook, splitEarnings } from "./payments";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { isSafeHttpsUrl, isSafeImageSource } from "@shared/media";
import { PAPER_PLANS, PAPER_RATES } from "@shared/paper";
import { publicOriginForRequest } from "./security";
import { lookupDictionary, normalizeDictionaryLanguage } from "./dictionary";
import {
  searchGutenberg,
  fetchGutenbergBookById,
  processGutenbergBook,
  translateText,
  SUPPORTED_LANGUAGES,
} from "./gutenberg";

const gutenbergImportSchema = z.object({
  gutenbergId: z.coerce.number().int().positive(),
  genre: z.string().trim().max(60).optional().default(""),
  overrideTitle: z.string().trim().max(200).optional().default(""),
  overrideSynopsis: z.string().trim().max(8_000).optional().default(""),
  lang: z.string().trim().toLowerCase().max(12).optional().default("es"),
}).strict()

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  registerAudioRoutes(app)
  registerNarrativeRoutes(app)
  registerSpeechRoutes(app)

  const AUTHOR_BOOK_FIELDS = [
    "title", "author", "coverUrl", "coverFx", "content", "synopsis", "genre",
    "chapters", "type", "status", "spotifyLink", "backCoverUrl", "premiumCoverUrl",
    "premiumBackUrl", "commentsEnabled", "publicationYear", "originalLanguage",
  ] as const
  function authorBookInput(input: any, user: any) {
    const safe: any = {}
    for (const key of AUTHOR_BOOK_FIELDS) if (input[key] !== undefined) safe[key] = input[key]
    safe.author = user?.name || input.author
    if (safe.status !== "published" && safe.status !== "draft") safe.status = "draft"
    return safe
  }

  function canViewBook(req: any, book: any): boolean {
    if (book?.status === "published") return true
    if (!req.isAuthenticated()) return false
    return isAdmin(req.user) || (!!book?.authorId && book.authorId === (req.user as any)?.id)
  }

  function withoutPremiumArt<T extends Record<string, any>>(book: T, allowed: boolean): T {
    if (allowed) return book
    return { ...book, premiumCoverUrl: "", premiumBackUrl: "" }
  }

  // El cliente puede decidir qué vestido mostrar, pero las URLs premium no
  // deben viajar a quien no tiene derecho: ocultarlas sólo en React no es
  // control de acceso.
  async function entitledBookIds(req: any, catalog: Array<{ id: number; authorId?: number | null }>): Promise<Set<number>> {
    if (!req.isAuthenticated() || catalog.length === 0) return new Set()
    if (isAdmin(req.user)) return new Set(catalog.map(book => book.id))
    const userId = (req.user as any).id as number
    const ids = catalog.map(book => book.id)
    const allowed = new Set(catalog.filter(book => book.authorId === userId).map(book => book.id))
    const [unlocked, cards] = await Promise.all([
      db.select({ bookId: unlockedBooks.bookId }).from(unlockedBooks).where(and(
        eq(unlockedBooks.userId, userId), inArray(unlockedBooks.bookId, ids),
      )),
      db.select({ bookId: bookCards.bookId }).from(userCards)
        .innerJoin(bookCards, eq(userCards.cardId, bookCards.id))
        .where(and(eq(userCards.userId, userId), inArray(bookCards.bookId, ids))),
    ])
    for (const row of unlocked) allowed.add(row.bookId)
    for (const row of cards) if (row.bookId != null) allowed.add(row.bookId)
    return allowed
  }

  const PROFILE_FRAMES_BASE = new Set(["", "silver", "purple", "crimson", "azure", "emerald"])
  const PROFILE_FRAMES_ALL = new Set([...PROFILE_FRAMES_BASE, "metallic", "cosmic", "oldgold"])

  function cleanProfileFrame(value: unknown, admin: boolean, current = ""): string | null {
    if (typeof value !== "string") return null
    const frame = value.trim()
    if (PROFILE_FRAMES_BASE.has(frame) || (admin && PROFILE_FRAMES_ALL.has(frame)) || frame === current) return frame
    return null
  }

  async function allowedProfileFrame(value: unknown, userId: number, admin: boolean, current = ""): Promise<string | null> {
    if (typeof value !== "string") return null
    const requested = value.trim()
    const match = requested.match(/^gallery:(\d+)$/)
    if (!match) return cleanProfileFrame(requested, admin, current)
    const frameId = Number(match[1])
    const [frame] = await db.select().from(frames).where(eq(frames.id, frameId))
    if (!frame || (frame.target !== "profile" && frame.target !== "both")) return null
    if (admin || requested === current || (frame.visible && frame.priceTinta <= 0)) return requested
    const [owned] = await db.select().from(userFrames).where(and(
      eq(userFrames.userId, userId), eq(userFrames.frameId, frameId),
    ))
    return owned ? requested : null
  }

  const EXTERNAL_LANGS = new Set(Object.keys(SUPPORTED_LANGUAGES))
  function externalLanguage(value: unknown, fallback = "es"): string {
    const code = String(value || "").trim().toLowerCase().replace(/_/g, "-").split("-", 1)[0]
    return EXTERNAL_LANGS.has(code) ? code : fallback
  }

  function cleanSocialValue(value: unknown): string | null {
    if (typeof value !== "string") return null
    const clean = value.trim().slice(0, 300)
    if (!clean || /[\u0000-\u001f\u007f]/.test(clean)) return null
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(clean) && !isSafeHttpsUrl(clean, 300)) return null
    return clean
  }

  // ── GET /api/books ────────────────────────────────────
  app.get(api.books.list.path, async (req, res) => {
    try {
      const catalog = await storage.getBooks();
      const entitled = await entitledBookIds(req, catalog)
      res.json(catalog.map(book => withoutPremiumArt(book, entitled.has(book.id))));
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });

  // ── GET /api/books/:id ────────────────────────────────
  app.get(api.books.get.path, async (req, res) => {
    try {
      const book = await storage.getBook(Number(req.params.id));
      if (!book) return res.status(404).json({ message: "Book not found" });

      // Libros no publicados (ocultos/en revisión): solo admin o su autor
      if (!canViewBook(req, book)) {
        return res.status(404).json({ message: "Book not found" });
      }

      // Enriquecer con la foto y marco del autor (para la tarjeta de la sinopsis)
      let authorAvatar = "", authorFrame = ""
      try {
        if ((book as any).authorId) {
          const [u] = await db.select().from(users).where(eq(users.id, (book as any).authorId))
          authorAvatar = u?.avatar || ""
          authorFrame  = (u as any)?.frame || ""
        } else if (book.author) {
          const [ap] = await db.select().from(authorProfiles)
            .where(eq(authorProfiles.nameKey, book.author.toLowerCase()))
          authorAvatar = ap?.avatar || ""
          authorFrame  = (ap as any)?.frame || ""
        }
      } catch { /* si falla, simplemente no hay avatar */ }

      const entitled = await entitledBookIds(req, [book])
      res.json({ ...withoutPremiumArt(book as any, entitled.has(book.id)), authorAvatar, authorFrame });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch book" });
    }
  });

  // ── POST /api/books ───────────────────────────────────
  // Asocia el libro al usuario autenticado si hay sesión activa
  app.post(api.books.create.path, rateLimit(60_000, 6), async (req, res) => {
    try {
      // Publicar requiere sesión (evita spam anónimo al catálogo)
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Inicia sesión para publicar" });
      }
      const input = api.books.create.input.parse(req.body);

      // El autor es SIEMPRE quien está en la sesión (no se acepta del body)
      const authorId = (req.user as any)?.id ?? null;

      const book = await storage.createBook({
        ...authorBookInput(input, req.user),
        authorId,
      });
      res.status(201).json(book);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field:   err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Failed to create book" });
    }
  });

  // ── PUT /api/books/:id ────────────────────────────────
  // Solo el autor puede actualizar su propio libro
  app.put(api.books.update.path, rateLimit(60_000, 24), async (req, res) => {
    try {
      const id      = Number(req.params.id);
      const input   = api.books.update.input.parse(req.body);
      const existing = await storage.getBook(id);

      if (!existing) return res.status(404).json({ message: "Book not found" });

      const userIsAdmin = req.isAuthenticated() && isAdmin(req.user);

      // Autorización:
      //  - Admin puede editar cualquier libro (incluidos los clásicos).
      //  - Si el libro tiene autor, solo ese autor (o un admin) puede editarlo.
      //  - Si el libro NO tiene autor (clásico/catálogo), solo un admin puede editarlo.
      if (!userIsAdmin) {
        if (existing.authorId) {
          const userId = req.isAuthenticated() ? (req.user as any)?.id : null;
          if (existing.authorId !== userId) {
            return res.status(403).json({ message: "No tienes permiso para editar este libro" });
          }
        } else {
          return res.status(403).json({ message: "Solo un administrador puede editar este libro" });
        }
      }

      const updated = await storage.updateBook(
        id,
        userIsAdmin ? input : authorBookInput(input, req.user),
      );
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field:   err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  // ── DELETE /api/books/:id ─────────────────────────────
  app.delete(api.books.delete.path, rateLimit(60_000, 12), async (req, res) => {
    try {
      const id       = Number(req.params.id);
      const existing = await storage.getBook(id);

      if (!existing) return res.status(404).json({ message: "Book not found" });

      // Autorización estricta:
      //  - Hay que estar autenticado SIEMPRE.
      //  - Admin puede borrar cualquier libro.
      //  - El autor solo puede borrar los suyos.
      //  - Libros sin autor (clásicos) solo los borra un admin.
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Inicia sesión" });
      }
      const userIsAdmin = isAdmin(req.user);
      const userId      = (req.user as any)?.id;
      const isOwner     = !!existing.authorId && existing.authorId === userId;
      if (!userIsAdmin && !isOwner) {
        return res.status(403).json({ message: "No tienes permiso para eliminar este libro" });
      }

      await storage.deleteBook(id);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete book" });
    }
  });

  // ════════════════════════════════════════════════════════
  // COMENTARIOS
  // ════════════════════════════════════════════════════════

  // Helper: ¿el usuario puede moderar este libro? (autor o admin)
  async function canModerate(req: any, book: any): Promise<boolean> {
    if (!req.isAuthenticated()) return false
    if (isAdmin(req.user)) return true
    const userId = (req.user as any)?.id
    return !!(book.authorId && book.authorId === userId)
  }

  // LISTAR comentarios de un libro (opcionalmente de un capítulo)
  // El autor/admin ve también los ocultos (para moderar).
  app.get("/api/books/:id/comments", async (req, res) => {
    try {
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canViewBook(req, book)) return res.status(404).json({ message: "Libro no encontrado" })

      const chapterParam = req.query.chapter
      const chapterIndex = chapterParam !== undefined ? Number(chapterParam) : undefined

      const moderator = await canModerate(req, book)
      const list = await storage.getComments(bookId, {
        chapterIndex: chapterIndex !== undefined && !isNaN(chapterIndex) ? chapterIndex : undefined,
        includeHidden: moderator,
      })

      res.json({
        commentsEnabled: book.commentsEnabled !== false,
        canModerate:     moderator,
        comments:        list,
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error cargando comentarios" })
    }
  })

  // PUBLICAR un comentario (requiere sesión)
  app.post("/api/books/:id/comments", rateLimit(60_000, 6), async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Inicia sesión para comentar" })
      }
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canViewBook(req, book)) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.commentsEnabled === false) {
        return res.status(403).json({ message: "Los comentarios están desactivados en esta obra" })
      }

      const parsed = insertCommentSchema.safeParse({
        bookId,
        chapterIndex: req.body?.chapterIndex ?? 0,
        content:      req.body?.content ?? "",
      })
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Comentario inválido" })
      }
      const chapterCount = Array.isArray(book.chapters) && book.chapters.length ? book.chapters.length : 1
      const chapterIndex = parsed.data.chapterIndex ?? 0
      if (!Number.isInteger(chapterIndex) || chapterIndex < -1 || chapterIndex >= chapterCount) {
        return res.status(400).json({ message: "El capítulo no existe" })
      }

      const user = req.user as any
      const created = await storage.createComment({
        bookId,
        chapterIndex,
        userId:       user.id,
        userName:     user.name || "Lector",
        userAvatar:   user.avatar || "",
        content:      parsed.data.content,
      })
      res.status(201).json(created)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error publicando comentario" })
    }
  })

  // MODERAR un comentario: ocultar o restaurar (autor del libro o admin)
  app.patch("/api/comments/:id/status", rateLimit(60_000, 30), async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" })

      const status = String(req.body?.status || "")
      if (status !== "visible" && status !== "hidden") {
        return res.status(400).json({ message: "Estado inválido" })
      }

      const comment = await storage.getComment(id)
      if (!comment) return res.status(404).json({ message: "Comentario no encontrado" })

      const book = await storage.getBook(comment.bookId)
      if (!book || !(await canModerate(req, book))) {
        return res.status(403).json({ message: "No tienes permiso para moderar" })
      }

      const updated = await storage.setCommentStatus(id, status as "visible" | "hidden")
      res.json(updated)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error moderando" })
    }
  })

  // ENCENDER/APAGAR comentarios en una obra (autor del libro o admin)
  app.patch("/api/books/:id/comments-enabled", rateLimit(60_000, 20), async (req, res) => {
    try {
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!(await canModerate(req, book))) {
        return res.status(403).json({ message: "No tienes permiso" })
      }

      const enabled = !!req.body?.enabled
      const updated = await storage.updateBook(bookId, { commentsEnabled: enabled } as any)
      res.json({ commentsEnabled: updated.commentsEnabled })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── GUTENBERG PÚBLICO — búsqueda y preview para TODOS los usuarios ──
  // La importación al catálogo global sigue siendo solo admin

  app.get("/api/gutenberg/search", rateLimit(60_000, 20), async (req, res) => {
    try {
      const query      = String(req.query.q || "").trim().slice(0, 120)
      const searchLang = externalLanguage(req.query.lang)
      if (!query) return res.status(400).json({ message: "Falta el parámetro q" })

      const results     = await searchGutenberg(query, searchLang)
      const existing    = await storage.getBooks()
      const importedIds = new Set(existing.map((b: any) => b.gutenbergId).filter(Boolean))
      const enriched = results.map((r: any) => ({
        ...r,
        alreadyImported: importedIds.has(r.id),
        existingBookId:  existing.find((b: any) => b.gutenbergId === r.id)?.id || null,
      }))
      res.json(enriched)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error buscando en Gutenberg" })
    }
  })

  app.get("/api/gutenberg/preview/:id", rateLimit(60_000, 6), async (req, res) => {
    try {
      const gutId       = Number(req.params.id)
      const previewLang = externalLanguage(req.query.lang)
      if (!Number.isInteger(gutId) || gutId <= 0) return res.status(400).json({ message: "ID inválido" })

      // Si ya está en el catálogo, devolver ese
      const existing     = await storage.getBooks()
      const existingBook = existing.find((b: any) => b.gutenbergId === gutId)
      if (existingBook) {
        return res.json({ ...existingBook, existingBookId: existingBook.id, alreadyImported: true })
      }

      const book = await fetchGutenbergBookById(gutId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      const processed = await processGutenbergBook(book, previewLang)

      // Para descarga personal se devuelve el libro COMPLETO con contenido
      res.json({
        ...processed,
        gutenbergId:     gutId,
        chapterCount:    processed.chapters.length,
        previewText:     (processed.chapters[0]?.content || "").slice(0, 500) + "...",
        existingBookId:  null,
        alreadyImported: false,
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error cargando el libro" })
    }
  })

  // ── ADMIN: BUSCAR EN GUTENBERG ───────────────────────────
  app.get("/api/admin/gutenberg/search", requireAdmin, async (req, res) => {
    try {
      const query      = String(req.query.q || "").trim().slice(0, 120)
      const searchLang = externalLanguage(req.query.lang)

      if (!query) return res.status(400).json({ message: "Falta el parámetro q" })

      const results = await searchGutenberg(query, searchLang)
      res.json(results)
    } catch (err: any) {
      console.error("Gutenberg search error:", err)
      res.status(500).json({ message: err.message || "Error buscando en Gutenberg" })
    }
  })

  // ── ADMIN: PREVIEW DE UN LIBRO ────────────────────────────
  // Descarga y procesa sin guardar en BD — para revisar antes de importar
  app.get("/api/admin/gutenberg/preview/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID inválido" })

      // Buscar el libro por ID en Gutendex
      const previewLang = externalLanguage(req.query.lang)
      const book = await fetchGutenbergBookById(id)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      const processed   = await processGutenbergBook(book, previewLang)

      res.json({
        ...processed,
        chapterCount: processed.chapters.length,
        // Solo preview del primer capítulo para no enviar todo al cliente
        previewText: processed.chapters[0]?.content?.slice(0, 500) + "...",
        chapters: processed.chapters.map(c => ({
          title:     c.title,
          wordCount: c.content.split(/\s+/).length,
        })),
      })
    } catch (err: any) {
      console.error("Gutenberg preview error:", err)
      res.status(500).json({ message: err.message || "Error procesando libro" })
    }
  })

  // ── ADMIN: IMPORTAR UN LIBRO ──────────────────────────────
  app.post("/api/admin/gutenberg/import", requireAdmin, rateLimit(60_000, 6), async (req, res) => {
    try {
      const parsed = gutenbergImportSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ message: "Datos de importación inválidos" })
      const { gutenbergId, genre, overrideTitle, overrideSynopsis, lang: importLang } = parsed.data

      // Incluye borradores, revisión y retiros lógicos; getBooks() solo ve
      // publicados y permitía volver a importar el mismo Gutenberg ID.
      const existing = await storage.findBookByGutenbergId(gutenbergId)
      if (existing) {
        return res.status(409).json({
          message: "Este libro ya está importado",
          existingBookId: existing.id,
          existingStatus: existing.status,
        })
      }

      // Descargar y procesar
      const gutBook = await fetchGutenbergBookById(gutenbergId)
      if (!gutBook) return res.status(404).json({ message: "Libro no encontrado en Gutenberg" })
      const processed = await processGutenbergBook(gutBook, externalLanguage(importLang))

      // Guardar en BD
      const book = await storage.createBook({
        title:           overrideTitle || processed.title,
        author:          processed.author,
        synopsis:        overrideSynopsis || processed.synopsis,
        coverUrl:        processed.coverUrl,
        genre:           genre || processed.detectedGenre,
        type:            processed.type,
        status:          "published",
        isClassic:       true,
        publicationYear: processed.publicationYear,
        originalLanguage: processed.originalLanguage,
        gutenbergId,
        chapters:        processed.chapters,
        content:         "",
        isSaved:         false,
        isAuthored:      false,
      })

      res.status(201).json({
        book,
        stats: {
          chapters:  processed.chapters.length,
          wordCount: processed.wordCount,
          genre:     processed.detectedGenre,
        }
      })
    } catch (err: any) {
      console.error("IMPORT ERROR:", err?.message, err?.stack)
      if (err?.code === "23505" && String(err?.constraint || "").includes("gutenberg")) {
        return res.status(409).json({ message: "Este libro ya está importado" })
      }
      res.status(500).json({ message: err.message || "Error importando libro" })
    }
  })

  // ── ADMIN: ELIMINAR LIBRO DEL CATÁLOGO ──────────────────
  app.delete("/api/admin/books/:id", requireAdmin, rateLimit(60_000, 10), async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" })

      const existing = await storage.getBook(id)
      if (!existing) return res.status(404).json({ message: "Libro no encontrado" })

      await storage.deleteBook(id)
      res.status(204).send()
    } catch (err: any) {
      console.error("Admin delete error:", err)
      res.status(500).json({ message: err.message || "Error eliminando libro" })
    }
  })

  // ── ADMIN: LISTAR TODOS LOS LIBROS (incluye ocultos/borradores) ──
  // Para que el admin pueda ver y auditar los libros "en revisión"
  app.get("/api/admin/books/all", requireAdmin, async (_req, res) => {
    try {
      const all = await db.select().from(books)
      res.json(all)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── ADMIN: CAMBIAR VISIBILIDAD DE UN LIBRO ──
  // Ocultar para revisión ("review") o volver a publicar ("published")
  app.patch("/api/admin/books/:id/visibility", requireAdmin, rateLimit(60_000, 30), async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" })

      const status = String(req.body?.status || "")
      if (status !== "review" && status !== "published") {
        return res.status(400).json({ message: "Estado inválido" })
      }

      const existing = await storage.getBook(id)
      if (!existing) return res.status(404).json({ message: "Libro no encontrado" })

      const updated = await storage.updateBook(id, { status } as any)
      res.json(updated)
    } catch (err: any) {
      console.error("Visibility error:", err)
      res.status(500).json({ message: err.message || "Error cambiando visibilidad" })
    }
  })

  // ── ADMIN: VERIFICAR ROL ──────────────────────────────────
  app.get("/api/admin/me", requireAdmin, (req, res) => {
    res.json({ isAdmin: true, user: req.user })
  })

  // ── ADMIN: LISTAR ADMINISTRADORES ────────────────────────
  app.get("/api/admin/admins", requireAdmin, async (_req, res) => {
    try {
      const rows = await db.select().from(admins)
      res.json(rows)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── ADMIN: AGREGAR ADMINISTRADOR ─────────────────────────
  app.post("/api/admin/admins", requireAdmin, rateLimit(60_000, 10), async (req, res) => {
    try {
      const parsedEmail = z.string().trim().email().max(254).safeParse(req.body?.email)
      if (!parsedEmail.success) {
        return res.status(400).json({ message: "Email inválido" })
      }
      const email = parsedEmail.data.toLowerCase()
      const addedBy = (req.user as any)?.email || "unknown"
      const existing = await db.select().from(admins).where(eq(admins.email, email))
      if (existing.length > 0) {
        return res.status(409).json({ message: "Este email ya es administrador" })
      }
      const [row] = await db.insert(admins).values({ email, addedBy }).returning()
      await refreshAdminCache()
      res.status(201).json(row)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── ADMIN: ELIMINAR ADMINISTRADOR ────────────────────────
  app.delete("/api/admin/admins/:email", requireAdmin, rateLimit(60_000, 10), async (req, res) => {
    try {
      const emailToRemove = decodeURIComponent(String(req.params.email)).trim().toLowerCase()
      // El fundador no puede ser eliminado
      if (emailToRemove === FOUNDER_EMAIL) {
        return res.status(403).json({ message: "No puedes eliminar al administrador fundador" })
      }
      await db.delete(admins).where(eq(admins.email, emailToRemove))
      await refreshAdminCache()
      res.status(204).send()
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })


  // ── PROXY DICCIONARIO ────────────────────────────────────
  app.get("/api/dictionary/:word", rateLimit(60_000, 30), async (req, res) => {
    const word     = String(req.params.word || "").normalize("NFKC").trim().slice(0, 80)
    const userLang = normalizeDictionaryLanguage(externalLanguage(req.query.lang))
    const target   = normalizeDictionaryLanguage(externalLanguage(req.query.target, userLang), userLang)
    if (!word || word.length < 2 || !/^[\p{L}\p{M}'’-]+$/u.test(word)) {
      return res.status(400).json({
        word, sourceLanguage: userLang, targetLanguage: target,
        definitionLanguage: target, senses: [], translation: "", source: "", sourceUrl: "",
      })
    }
    try {
      res.json(await lookupDictionary(word, userLang, target, translateText))
    } catch {
      res.json({
        word, sourceLanguage: userLang, targetLanguage: target,
        definitionLanguage: target, senses: [], translation: "", source: "", sourceUrl: "",
      })
    }
  })


  // ── PERFIL DE AUTOR ──────────────────────────────────────
  app.get("/api/authors/:name", async (req, res) => {
    try {
      const authorName = decodeURIComponent(req.params.name)
      // Buscar libros publicados de este autor
      const authorBooks = await storage.getBooks()
      const filteredRaw = authorBooks.filter(b =>
        b.author?.toLowerCase() === authorName.toLowerCase()
      )

      const entitled = await entitledBookIds(req, filteredRaw)
      const filtered = filteredRaw.map(book => withoutPremiumArt(book, entitled.has(book.id)))

      if (filtered.length === 0) {
        return res.json({ name: authorName, avatar: null, books: [] })
      }

      // Buscar el usuario con ese nombre para obtener su avatar, bio y enlaces
      let avatar: string | null = null
      let banner = ""
      let bio = ""
      let frame = ""
      let socialLinks: Record<string, string> = {}
      let isClassicProfile = false
      const authorId = filtered.find(b => b.authorId)?.authorId
      if (authorId) {
        // Autor registrado: su perfil vive en su cuenta
        const [user] = await db.select().from(users).where(eq(users.id, authorId))
        avatar      = user?.avatar || null
        banner      = (user as any)?.banner || ""
        bio         = (user as any)?.bio || ""
        frame       = (user as any)?.frame || ""
        socialLinks = ((user as any)?.socialLinks as Record<string, string>) || {}
      } else {
        // Autor clásico (sin cuenta): su perfil vive en author_profiles
        isClassicProfile = true
        const [ap] = await db.select().from(authorProfiles)
          .where(eq(authorProfiles.nameKey, authorName.toLowerCase()))
        if (ap) {
          avatar      = ap.avatar || null
          banner      = (ap as any).banner || ""
          bio         = ap.bio || ""
          frame       = (ap as any).frame || ""
          socialLinks = (ap.socialLinks as Record<string, string>) || {}
        }
      }

      res.json({ name: authorName, avatar, banner, bio, frame, socialLinks, authorId: authorId ?? null, isClassicProfile, books: filtered })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // CORAZONES de una obra: señal de mérito orgánico (sin estrellas).
  // Se compone de apoyos (unlockedBooks) + lectores que avanzaron de verdad.
  // No es un ranking comparativo, solo un reflejo de que la obra resonó.
  app.get("/api/books/:id/hearts", async (req, res) => {
    try {
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const book = await storage.getBook(bookId)
      if (!book || !canViewBook(req, book)) return res.status(404).json({ message: "Libro no encontrado" })
      const totalChapters = Array.isArray(book?.chapters) ? book.chapters.length : 1

      // Apoyos: cuántos desbloquearon la obra apoyándola (no reclamos físicos)
      const supports = await db.select().from(unlockedBooks)
        .where(and(eq(unlockedBooks.bookId, bookId), eq(unlockedBooks.source, "support")))
      const supportCount = supports.length

      // Retención: lectores cuyo capítulo más lejano llegó cerca del final
      const progresses = await db.select().from(readingProgress)
        .where(eq(readingProgress.bookId, String(bookId)))
      const readers = progresses.length
      const finishers = progresses.filter(p =>
        totalChapters > 0 && p.maxChapter >= Math.max(1, totalChapters - 1)).length

      // El corazón pondera sobre todo la RETENCIÓN: quien termina de leer pesa
      // más que un apoyo. Terminar=4, apoyar=3, empezar=1. La lectura manda.
      const hearts = finishers * 4 + supportCount * 3 + Math.max(0, readers - finishers)

      res.json({ hearts, supportCount, readers, finishers, totalChapters })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Tarjeta ligera del autor (solo foto + marco) para la sinopsis.
  app.get("/api/authors/:name/card", async (req, res) => {
    try {
      const authorName = decodeURIComponent(req.params.name)
      const nameKey = authorName.toLowerCase()

      // ¿Autor registrado? (algún libro suyo con authorId)
      const mine = await db.select({ authorId: books.authorId }).from(books)
        .where(and(
          eq(books.status, "published"),
          sql`lower(${books.author}) = ${nameKey}`,
        ))
        .limit(20)
      const authorId = mine.find(b => b.authorId)?.authorId

      let avatar = "", frame = ""
      if (authorId) {
        const [user] = await db.select().from(users).where(eq(users.id, authorId))
        avatar = user?.avatar || ""
        frame  = (user as any)?.frame || ""
      } else {
        const [ap] = await db.select().from(authorProfiles).where(eq(authorProfiles.nameKey, nameKey))
        avatar = ap?.avatar || ""
        frame  = (ap as any)?.frame || ""
      }
      res.json({ avatar, frame })
    } catch (err: any) {
      res.json({ avatar: "", frame: "" })
    }
  })

  // ── PERFIL: el autor edita su bio y enlaces sociales ──
  app.patch("/api/profile", rateLimit(60_000, 12), async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Inicia sesión" })
      }
      const userId = (req.user as any)?.id

      // Solo se permiten estas redes (lista curada). Cada valor es texto.
      const ALLOWED = ["instagram", "x", "telegram", "youtube", "tiktok", "wikipedia", "website", "patreon", "kofi"]
      const incoming = (req.body?.socialLinks || {}) as Record<string, string>
      const clean: Record<string, string> = {}
      for (const key of ALLOWED) {
        const val = cleanSocialValue(incoming[key])
        if (val) clean[key] = val
      }

      const bio = typeof req.body?.bio === "string"
        ? req.body.bio.trim().slice(0, 500)
        : undefined

      const updates: any = { socialLinks: clean, updatedAt: new Date() }
      if (bio !== undefined) updates.bio = bio

      // Marco del avatar (id corto)
      if (typeof req.body?.frame === "string") {
        const frame = await allowedProfileFrame(
          req.body.frame, userId, isAdmin(req.user), String((req.user as any)?.frame || ""),
        )
        if (frame === null) return res.status(403).json({ message: "No tienes acceso a ese marco" })
        updates.frame = frame
      }

      // Foto propia (base64 o enlace). Marca customAvatar para no perderla al re-loguear.
      if (typeof req.body?.avatar === "string") {
        const av = req.body.avatar.trim().slice(0, 3_000_000)
        if (!isSafeImageSource(av)) return res.status(400).json({ message: "Imagen de perfil no permitida" })
        updates.avatar = av
        updates.customAvatar = av.length > 0   // si la quita, vuelve a tomar la de Google al loguear
      }

      // Banner (portada del perfil)
      if (typeof req.body?.banner === "string") {
        const banner = req.body.banner.trim().slice(0, 3_000_000)
        if (!isSafeImageSource(banner)) return res.status(400).json({ message: "Banner no permitido" })
        updates.banner = banner
      }

      const [updated] = await db.update(users).set(updates).where(eq(users.id, userId)).returning()
      res.json({
        bio:         (updated as any)?.bio || "",
        avatar:      (updated as any)?.avatar || "",
        banner:      (updated as any)?.banner || "",
        frame:       (updated as any)?.frame || "",
        socialLinks: (updated as any)?.socialLinks || {},
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error guardando perfil" })
    }
  })

  // ── ADMIN: editar el perfil de un autor CLÁSICO (sin cuenta) ──
  app.patch("/api/admin/authors/:name", requireAdmin, rateLimit(60_000, 12), async (req, res) => {
    try {
      const name    = decodeURIComponent(String(req.params.name))
      const nameKey = name.toLowerCase()

      const ALLOWED = ["instagram", "x", "telegram", "youtube", "tiktok", "wikipedia", "website", "patreon", "kofi"]
      const incoming = (req.body?.socialLinks || {}) as Record<string, string>
      const clean: Record<string, string> = {}
      for (const key of ALLOWED) {
        const val = cleanSocialValue(incoming[key])
        if (val) clean[key] = val
      }

      const bio    = typeof req.body?.bio === "string"    ? req.body.bio.trim().slice(0, 500)    : ""
      // El avatar puede ser una foto en base64 (larga) o un enlace (corto).
      const avatar = typeof req.body?.avatar === "string" ? req.body.avatar.trim().slice(0, 3_000_000) : ""
      const frame  = await allowedProfileFrame(req.body?.frame, (req.user as any)?.id, true) ?? ""
      const banner = typeof req.body?.banner === "string" ? req.body.banner.trim().slice(0, 3_000_000) : ""
      if (!isSafeImageSource(avatar) || !isSafeImageSource(banner)) {
        return res.status(400).json({ message: "Imagen no permitida" })
      }

      // Upsert por nameKey
      const [existing] = await db.select().from(authorProfiles).where(eq(authorProfiles.nameKey, nameKey))
      if (existing) {
        const [updated] = await db.update(authorProfiles)
          .set({ displayName: name, bio, avatar, banner, frame, socialLinks: clean, updatedAt: new Date() })
          .where(eq(authorProfiles.nameKey, nameKey))
          .returning()
        res.json(updated)
      } else {
        const [created] = await db.insert(authorProfiles)
          .values({ nameKey, displayName: name, bio, avatar, banner, frame, socialLinks: clean })
          .returning()
        res.json(created)
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error guardando perfil del clásico" })
    }
  })

  // ════════════════════════════════════════════════════════
  // SINCRONIZACIÓN (racha + progreso de lectura)
  // ════════════════════════════════════════════════════════

  // Leer el estado del usuario (para juntarlo con lo local al abrir la app)
  app.get("/api/sync/state", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      const [state] = await db.select().from(userState).where(eq(userState.userId, userId))
      const progress = await db.select().from(readingProgress).where(eq(readingProgress.userId, userId))

      res.json({
        streak: state
          ? { days: state.streakDays, lastDate: state.streakLastDate || "" }
          : null,
        progress: progress.map(p => ({
          bookId: p.bookId, chapter: p.chapter, maxChapter: p.maxChapter,
        })),
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Subir la racha (lo local manda; el servidor solo respalda el valor)
  app.put("/api/sync/streak", rateLimit(60_000, 30), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      const rawDays = Number(req.body?.days)
      if (!Number.isInteger(rawDays) || rawDays < 0 || rawDays > 36_500) {
        return res.status(400).json({ message: "Racha inválida" })
      }
      const days     = rawDays
      const lastDate = typeof req.body?.lastDate === "string" ? req.body.lastDate.slice(0, 40) : ""

      const [existing] = await db.select().from(userState).where(eq(userState.userId, userId))
      if (existing) {
        await db.update(userState)
          .set({ streakDays: days, streakLastDate: lastDate, updatedAt: new Date() })
          .where(eq(userState.userId, userId))
      } else {
        await db.insert(userState).values({ userId, streakDays: days, streakLastDate: lastDate })
      }
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Subir el progreso de un libro (nunca retrocede: guarda el máximo)
  app.put("/api/sync/progress", rateLimit(60_000, 60), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      const numericBookId = Number(req.body?.bookId)
      if (!Number.isInteger(numericBookId) || numericBookId <= 0 || numericBookId > 2_147_483_647) {
        return res.status(400).json({ message: "Libro inválido" })
      }
      const book = await storage.getBook(numericBookId)
      if (!book || !canViewBook(req, book)) return res.status(404).json({ message: "Libro no encontrado" })
      const rawChapter = Number(req.body?.chapter)
      const rawMaxChapter = Number(req.body?.maxChapter)
      if (!Number.isInteger(rawChapter) || !Number.isInteger(rawMaxChapter)
          || rawChapter < 0 || rawMaxChapter < 0) {
        return res.status(400).json({ message: "Progreso inválido" })
      }
      const chapterCount = Array.isArray(book.chapters) && book.chapters.length > 0 ? book.chapters.length : 1
      const lastChapter = Math.max(0, chapterCount - 1)
      if (rawChapter > lastChapter || rawMaxChapter > lastChapter) {
        return res.status(400).json({ message: "El capítulo no existe" })
      }
      const bookId = String(numericBookId)
      const chapter = rawChapter
      const maxChapter = rawMaxChapter

      const [existing] = await db.select().from(readingProgress)
        .where(and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId)))

      if (existing) {
        await db.update(readingProgress)
          .set({
            chapter,                                          // capítulo actual (puede ir atrás)
            maxChapter: Math.max(Math.min(existing.maxChapter, lastChapter), maxChapter),
            updatedAt: new Date(),
          })
          .where(and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId)))
      } else {
        await db.insert(readingProgress).values({ userId, bookId, chapter, maxChapter })
      }
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Biblioteca guardada en la nube ──────────────────────────
  // GET: devuelve los libros guardados COMPLETOS (para restaurar en otro dispositivo)
  app.get("/api/sync/library", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      const rows = await db.select().from(savedBooks).where(eq(savedBooks.userId, userId))
      if (rows.length === 0) return res.json({ books: [] })

      const ids  = rows.map(r => r.bookId)
      const list = await db.select().from(books).where(inArray(books.id, ids))
      const entitled = await entitledBookIds(req, list)
      // Solo restaurar los que siguen publicados
      res.json({ books: list.filter(b => b.status === "published").map(book =>
        withoutPremiumArt(book, entitled.has(book.id))) })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // PUT: marcar un libro como guardado (idempotente)
  app.put("/api/sync/library/:bookId", rateLimit(60_000, 60), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.params.bookId)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (!canViewBook(req, book)) return res.status(404).json({ message: "Libro no encontrado" })

      const [existing] = await db.select().from(savedBooks)
        .where(and(eq(savedBooks.userId, userId), eq(savedBooks.bookId, bookId)))
      if (!existing) {
        await db.insert(savedBooks).values({ userId, bookId })
      }
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // DELETE: quitar un libro de guardados
  app.delete("/api/sync/library/:bookId", rateLimit(60_000, 60), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.params.bookId)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      await db.delete(savedBooks)
        .where(and(eq(savedBooks.userId, userId), eq(savedBooks.bookId, bookId)))
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ════════════════════════════════════════════════════════
  // SISTEMA DE TOKENS — fase 1 (plomería, sin pagos todavía)
  // ════════════════════════════════════════════════════════

  // Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) — legible en papel
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  function randomCode(len: number): string {
    const bytes = randomBytes(len)
    let out = ""
    for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
    return out
  }
  const makeFolio = () => `TLQ-${randomCode(4)}-${randomCode(4)}`
  const makeKey   = () => `${randomCode(4)}-${randomCode(4)}`

  async function uniqueFolio(executor: any = db): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const f = makeFolio()
      const [dup] = await executor.select().from(printCopies).where(eq(printCopies.folio, f))
      if (!dup) return f
    }
    throw new Error("No se pudo generar un folio único")
  }

  async function ensureUnlock(userId: number, bookId: number, source: string, executor: any = db) {
    await executor.insert(unlockedBooks).values({ userId, bookId, source }).onConflictDoNothing()
  }

  // Emite un token dentro del ejecutor/transacción recibido.
  async function issueTokenWith(executor: any, userId: number, bookId: number, kind: "support" | "sale") {
    const copiesToMake = kind === "support" ? 3 : 1
    const [token] = await executor.insert(bookTokens)
      .values({ kind, bookId, ownerUserId: userId }).returning()
    const copies = []
    for (let i = 0; i < copiesToMake; i++) {
      const folio = await uniqueFolio(executor)
      const isOwnerCopy = kind === "support" && i === 0
      const [copy] = await executor.insert(printCopies).values({
        tokenId: token.id,
        folio,
        claimKey: makeKey(),
        claimedByUserId: isOwnerCopy ? userId : null,
        claimedAt: isOwnerCopy ? new Date() : null,
      }).returning()
      copies.push(copy)
    }
    if (kind === "support") await ensureUnlock(userId, bookId, "support", executor)
    return { token, copies }
  }

  // Valida si un usuario puede adquirir un token de este libro
  async function validateAcquire(userId: number, bookId: number, kind: string) {
    const book = await storage.getBook(bookId)
    if (!book || book.status !== "published") return { error: "Libro no encontrado", code: 404, book: null }
    if (book.isClassic || !book.authorId) {
      return { error: "Los clásicos son de dominio público: no necesitan token", code: 400, book: null }
    }
    if (kind === "support" && book.authorId === userId) {
      return { error: "Esta obra es tuya: ya tienes acceso completo", code: 400, book: null }
    }
    if (kind === "support") {
      const mine = await db.select().from(bookTokens)
        .where(and(eq(bookTokens.bookId, bookId), eq(bookTokens.ownerUserId, userId), eq(bookTokens.kind, "support")))
      if (mine.length > 0) return { error: "Ya tienes el token de apoyo de esta obra", code: 409, book: null }
    }
    return { error: null, code: 200, book }
  }

  // ADQUIRIR un token → crea una ORDEN.
  //  · Sin Stripe configurado (beta): se confirma gratis al instante y emite.
  //  · Con Stripe: devuelve la URL de pago; el webhook emitirá al confirmarse.
  // Saldo de una moneda = SUMA del libro contable (fuente única de verdad)
  async function walletBalance(userId: number, currency: "tinta" | "papel"): Promise<number> {
    const [row] = await db.select({ bal: sql<number>`coalesce(sum(${walletLedger.delta}), 0)` })
      .from(walletLedger)
      .where(and(eq(walletLedger.userId, userId), eq(walletLedger.currency, currency)))
    return Number(row?.bal || 0)
  }

  // Asienta la ganancia del autor de una orden pagada (reparto según tipo de obra:
  // cuentos 50/50 · libros 90/10)
  async function settleEarnings(order: { id: number; bookId: number; amountCents: number; currency: string }, shareOverride?: number, executor: any = db) {
    const book = await storage.getBook(order.bookId)
    if (!book?.authorId || order.amountCents <= 0) return
    const share = shareOverride ?? (isStory(book) ? AUTHOR_SHARE_STORY : AUTHOR_SHARE_BOOK)
    const { authorCents, platformCents } = splitEarnings(order.amountCents, share)
    await executor.insert(authorEarnings).values({
      authorUserId: book.authorId, orderId: order.id, bookId: order.bookId,
      grossCents: order.amountCents, authorCents, platformCents,
      currency: order.currency,
    }).onConflictDoNothing()
  }

  app.post("/api/tokens/acquire", rateLimit(60_000, 10), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.body?.bookId)
      const kind   = String(req.body?.kind || "")
      if (isNaN(bookId) || (kind !== "support" && kind !== "sale")) {
        return res.status(400).json({ message: "Solicitud inválida" })
      }
      const check = await validateAcquire(userId, bookId, kind)
      if (check.error) return res.status(check.code).json({ message: check.error })
      const book = check.book!

      const price = priceFor(kind as "support" | "sale", book)
      const payWith = String(req.body?.payWith || "money")

      // ── Pagar con TINTA 🪙 (un toque, sin pasarela) ──
      if (payWith === "tinta") {
        const purchase = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
          if (kind === "support") {
            const [owned] = await tx.select().from(bookTokens).where(and(
              eq(bookTokens.bookId, bookId),
              eq(bookTokens.ownerUserId, userId),
              eq(bookTokens.kind, "support"),
            ))
            if (owned) return { state: "owned" as const }
          }
          const [order] = await tx.insert(tokenOrders).values({
            userId, bookId, kind, amountCents: price.cents, currency: price.currency,
            status: "pending", provider: "tinta",
          }).returning()
          const r: any = await tx.execute(sql`
            insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
            select ${userId}, 'tinta', ${-price.tinta}, 'spend_token', 'token_order', ${order.id}
            where (select coalesce(sum(delta), 0) from wallet_ledger
                   where user_id = ${userId} and currency = 'tinta') >= ${price.tinta}
            returning id
          `)
          if ((r?.rows?.length ?? 0) === 0) {
            await tx.update(tokenOrders).set({ status: "failed" }).where(eq(tokenOrders.id, order.id))
            return { state: "funds" as const }
          }
          const result = await issueTokenWith(tx, userId, bookId, kind as "support" | "sale")
          await tx.update(tokenOrders)
            .set({ status: "paid", paidAt: new Date(), tokenId: result.token.id })
            .where(eq(tokenOrders.id, order.id))
          await settleEarnings({ ...order, amountCents: price.cents }, undefined, tx)
          return { state: "paid" as const, result }
        })
        if (purchase.state === "owned") {
          return res.status(409).json({ message: "Ya tienes el token de apoyo de esta obra" })
        }
        if (purchase.state === "funds") {
          const balance = await walletBalance(userId, "tinta")
          return res.status(402).json({
            message: "tinta_insuficiente", needed: price.tinta, balance,
          })
        }
        return res.status(201).json({ mode: "tinta", spent: price.tinta, ...purchase.result })
      }

      if (!stripeEnabled()) {
        if (!betaPaymentsEnabled()) {
          return res.status(503).json({ message: "Los pagos no están configurados" })
        }
        // ── Modo beta: sin cobro ──
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
          if (kind === "support") {
            const [owned] = await tx.select().from(bookTokens).where(and(
              eq(bookTokens.bookId, bookId),
              eq(bookTokens.ownerUserId, userId),
              eq(bookTokens.kind, "support"),
            ))
            if (owned) return { state: "owned" as const, issued: null }
          }
          const [order] = await tx.insert(tokenOrders).values({
            userId, bookId, kind, amountCents: 0, currency: price.currency,
            status: "paid", provider: "beta", paidAt: new Date(),
          }).returning()
          const issued = await issueTokenWith(tx, userId, bookId, kind as "support" | "sale")
          await tx.update(tokenOrders).set({ tokenId: issued.token.id })
            .where(eq(tokenOrders.id, order.id))
          return { state: "paid" as const, issued }
        })
        if (result.state === "owned") {
          return res.status(409).json({ message: "Ya tienes el token de apoyo de esta obra" })
        }
        return res.status(201).json({ mode: "free_beta", ...result.issued })
      }

      // ── Modo Stripe: crear orden pendiente y sesión de pago ──
      const orderResult = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        if (kind === "support") {
          const [owned] = await tx.select().from(bookTokens).where(and(
            eq(bookTokens.bookId, bookId),
            eq(bookTokens.ownerUserId, userId),
            eq(bookTokens.kind, "support"),
          ))
          if (owned) return { state: "owned" as const, order: null }
          const [pending] = await tx.select().from(tokenOrders).where(and(
            eq(tokenOrders.userId, userId),
            eq(tokenOrders.bookId, bookId),
            eq(tokenOrders.kind, "support"),
            eq(tokenOrders.provider, "stripe"),
            eq(tokenOrders.status, "pending"),
          ))
          if (pending && Date.now() - pending.createdAt.getTime() < 45 * 60_000) {
            return { state: "pending" as const, order: null }
          }
          if (pending) {
            await tx.update(tokenOrders).set({ status: "canceled" }).where(eq(tokenOrders.id, pending.id))
          }
        }
        const [order] = await tx.insert(tokenOrders).values({
          userId, bookId, kind, amountCents: price.cents, currency: price.currency,
          status: "pending", provider: "stripe",
        }).returning()
        return { state: "created" as const, order }
      })
      if (orderResult.state === "owned") {
        return res.status(409).json({ message: "Ya tienes el token de apoyo de esta obra" })
      }
      if (orderResult.state === "pending") {
        return res.status(409).json({ message: "Ya existe un pago pendiente para esta obra" })
      }
      const order = orderResult.order!

      const origin = publicOriginForRequest(req)
      const kindLabel = kind === "support" ? "Apoyo al autor" : "Permiso de venta"
      let session
      try {
        session = await createCheckoutSession({
          orderId: order.id, bookTitle: book.title, kindLabel,
          cents: price.cents, currency: price.currency, origin, bookId,
        })
      } catch (error) {
        await db.update(tokenOrders).set({ status: "failed" }).where(eq(tokenOrders.id, order.id))
        throw error
      }
      await db.update(tokenOrders).set({ providerRef: session.id })
        .where(eq(tokenOrders.id, order.id))

      res.status(201).json({ mode: "checkout", url: session.url, orderId: order.id })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error al emitir el token" })
    }
  })

  // WEBHOOK de Stripe: confirma la orden, emite el token y asienta la ganancia.
  app.post("/api/payments/webhook", async (req, res) => {
    try {
      const secret = process.env.STRIPE_WEBHOOK_SECRET || ""
      if (!secret) return res.status(501).json({ message: "Webhook no configurado" })

      const event = verifyStripeWebhook(
        (req as any).rawBody as Buffer,
        req.headers["stripe-signature"] as string | undefined,
        secret,
      )
      if (!event) return res.status(400).json({ message: "Firma inválida" })

      if (event.type === "checkout.session.completed") {
        const session = event.data?.object || {}
        // Solo metadata explícita: el client_reference_id lo comparten
        // tokens y monedero, y cruzarlos emitiría tokens equivocados.
        const orderId = Number(session.metadata?.orderId)
        if (!isNaN(orderId)) {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(71001, ${orderId})`)
            const [order] = await tx.select().from(tokenOrders).where(eq(tokenOrders.id, orderId))
            const validPayment = order?.provider === "stripe"
              && order.providerRef === session.id
              && session.payment_status === "paid"
              && Number(session.amount_total) === order.amountCents
              && String(session.currency || "").toLowerCase() === order.currency.toLowerCase()
            if (!order || order.status !== "pending" || !validPayment) return
            await tx.execute(sql`select pg_advisory_xact_lock(${order.userId})`)
            if (order.kind === "support") {
              const [owned] = await tx.select().from(bookTokens).where(and(
                eq(bookTokens.bookId, order.bookId),
                eq(bookTokens.ownerUserId, order.userId),
                eq(bookTokens.kind, "support"),
              ))
              if (owned) {
                console.error(`Paid duplicate support order requires refund: ${order.id}`)
                await tx.update(tokenOrders).set({ status: "needs_refund" }).where(eq(tokenOrders.id, order.id))
                return
              }
            }
            const result = await issueTokenWith(tx, order.userId, order.bookId, order.kind as "support" | "sale")
            await tx.update(tokenOrders)
              .set({ status: "paid", paidAt: new Date(), tokenId: result.token.id })
              .where(and(eq(tokenOrders.id, orderId), eq(tokenOrders.status, "pending")))
            await settleEarnings(order, undefined, tx)
          })
        }
        // ── Compra de TINTA: acreditar el monedero ──
        const walletOrderId = Number(session.metadata?.walletOrderId)
        if (!isNaN(walletOrderId) && walletOrderId > 0) {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(71002, ${walletOrderId})`)
            const [wo] = await tx.select().from(walletOrders).where(eq(walletOrders.id, walletOrderId))
            const validPayment = wo?.provider === "stripe"
              && wo.providerRef === session.id
              && session.payment_status === "paid"
              && Number(session.amount_total) === wo.amountCents
              && String(session.currency || "").toLowerCase() === "mxn"
            if (!wo || wo.status !== "pending" || !validPayment) return
            await tx.update(walletOrders)
              .set({ status: "paid", paidAt: new Date() })
              .where(and(eq(walletOrders.id, walletOrderId), eq(walletOrders.status, "pending")))
            await tx.insert(walletLedger).values({
              userId: wo.userId, currency: wo.currency, delta: wo.amount,
              reason: "purchase", refType: "wallet_order", refId: wo.id,
            })
          })
        }
      }
      res.json({ received: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Config pública de pagos. Con ?bookId= devuelve el precio EXACTO de esa
  // obra (cuento 5 🪙 · libro 10 🪙) en centavos y en Tinta.
  app.get("/api/payments/config", async (req, res) => {
    try {
      const bookId = Number(req.query.bookId)
      if (!isNaN(bookId) && bookId > 0) {
        const book = await storage.getBook(bookId)
        if (book) {
          return res.json({
            enabled: stripeEnabled(), beta: betaPaymentsEnabled(),
            tintaCents: TINTA_CENTS,
            prices: {
              support: priceFor("support", book),
              sale:    priceFor("sale", book),
            },
          })
        }
      }
      res.json({ enabled: stripeEnabled(), beta: betaPaymentsEnabled(), tintaCents: TINTA_CENTS, prices: PRICES })
    } catch {
      res.json({ enabled: stripeEnabled(), beta: betaPaymentsEnabled(), tintaCents: TINTA_CENTS, prices: PRICES })
    }
  })

  // ════════════════════════════════════════════════════════
  // MONEDERO — Tinta (apoyo) y Papel (medición de IA)
  // ════════════════════════════════════════════════════════

  // Saldos del usuario
  app.get("/api/wallet", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const [tinta, papel] = await Promise.all([
        walletBalance(userId, "tinta"),
        walletBalance(userId, "papel"),
      ])
      res.json({ tinta, papel })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Exportación real de datos propios. Incluye las obras del usuario, pero no
  // el contenido de terceros ni secretos de proveedores de pago/reclamo.
  app.get("/api/account/export", rateLimit(60_000, 3), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      res.setHeader("Cache-Control", "no-store")
      const [
        accountRows, stateRows, progressRows, savedRows, commentRows,
        workRows, authoredCardRows, collectedCardRows, ownedFrameRows,
        tokenRows, copyRows, ledgerRows, usageRows,
      ] = await Promise.all([
        db.select({
          id: users.id, email: users.email, name: users.name, avatar: users.avatar,
          banner: users.banner, bio: users.bio, frame: users.frame,
          socialLinks: users.socialLinks, createdAt: users.createdAt, updatedAt: users.updatedAt,
        }).from(users).where(eq(users.id, userId)),
        db.select().from(userState).where(eq(userState.userId, userId)),
        db.select().from(readingProgress).where(eq(readingProgress.userId, userId)),
        db.select().from(savedBooks).where(eq(savedBooks.userId, userId)),
        db.select().from(comments).where(eq(comments.userId, userId)),
        db.select().from(books).where(eq(books.authorId, userId)),
        db.select().from(bookCards).where(eq(bookCards.authorId, userId)),
        db.select().from(userCards).where(eq(userCards.userId, userId)),
        db.select().from(userFrames).where(eq(userFrames.userId, userId)),
        db.select({ id: bookTokens.id, kind: bookTokens.kind, bookId: bookTokens.bookId, createdAt: bookTokens.createdAt })
          .from(bookTokens).where(eq(bookTokens.ownerUserId, userId)),
        db.select({
          id: printCopies.id, tokenId: printCopies.tokenId, folio: printCopies.folio,
          digitalClaimed: sql<boolean>`${printCopies.claimedByUserId} IS NOT NULL`,
          claimedAt: printCopies.claimedAt,
        }).from(printCopies)
          .innerJoin(bookTokens, eq(printCopies.tokenId, bookTokens.id))
          .where(eq(bookTokens.ownerUserId, userId)),
        db.select().from(walletLedger).where(eq(walletLedger.userId, userId)).orderBy(desc(walletLedger.createdAt)),
        db.select().from(paperUsageEvents).where(eq(paperUsageEvents.userId, userId)).orderBy(desc(paperUsageEvents.createdAt)),
      ])
      res.json({
        schema: "tloque-account-export@1", exportedAt: new Date().toISOString(),
        account: accountRows[0] || null,
        reading: { state: stateRows[0] || null, progress: progressRows, savedBooks: savedRows },
        activity: { comments: commentRows },
        authorship: { works: workRows, cards: authoredCardRows },
        collection: { cards: collectedCardRows, frames: ownedFrameRows },
        print: { tokens: tokenRows, copies: copyRows },
        economy: { ledger: ledgerRows, paperUsage: usageRows },
      })
    } catch {
      res.status(500).json({ message: "No se pudo preparar la exportación" })
    }
  })

  // Paquetes de Tinta disponibles
  app.get("/api/wallet/packs", (_req, res) => {
    res.json({ enabled: stripeEnabled(), beta: betaPaymentsEnabled(), tintaCents: TINTA_CENTS, packs: TINTA_PACKS })
  })

  // Catálogo único de Papel. Es informativo hasta conectar suscripciones,
  // Oráculo y ElevenLabs; no acredita ni descuenta unidades por sí mismo.
  app.get("/api/paper/catalog", (_req, res) => {
    res.json({ beta: true, plans: PAPER_PLANS, rates: PAPER_RATES })
  })

  // Comprar un paquete (beta: se acredita gratis · Stripe: checkout)
  app.post("/api/wallet/buy", rateLimit(60_000, 6), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const pack = TINTA_PACKS.find(p => p.id === String(req.body?.packId || ""))
      if (!pack) return res.status(400).json({ message: "Paquete inválido" })

      if (!stripeEnabled()) {
        if (!betaPaymentsEnabled()) {
          return res.status(503).json({ message: "Los pagos no están configurados" })
        }
        // ── Modo beta: acreditar al instante, sin cobro ──
        await db.transaction(async (tx) => {
          const [order] = await tx.insert(walletOrders).values({
            userId, currency: "tinta", amount: pack.tinta, amountCents: 0,
            status: "paid", provider: "beta", paidAt: new Date(),
          }).returning()
          await tx.insert(walletLedger).values({
            userId, currency: "tinta", delta: pack.tinta,
            reason: "purchase", refType: "wallet_order", refId: order.id,
          })
        })
        return res.status(201).json({ mode: "free_beta", credited: pack.tinta })
      }

      const [order] = await db.insert(walletOrders).values({
        userId, currency: "tinta", amount: pack.tinta, amountCents: pack.cents,
        status: "pending", provider: "stripe",
      }).returning()
      const origin = publicOriginForRequest(req)
      let session
      try {
        session = await createCheckoutSession({
          orderId: order.id, bookTitle: `${pack.tinta} Tinta`, kindLabel: "Paquete de Tinta",
          cents: pack.cents, currency: "mxn", origin, bookId: 0,
          metaKey: "walletOrderId", successPath: `/?tinta=${order.id}`, cancelPath: "/",
        })
      } catch (error) {
        await db.update(walletOrders).set({ status: "failed" }).where(eq(walletOrders.id, order.id))
        throw error
      }
      await db.update(walletOrders).set({ providerRef: session.id })
        .where(eq(walletOrders.id, order.id))
      res.status(201).json({ mode: "checkout", url: session.url, orderId: order.id })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Movimientos recientes (transparencia del monedero)
  app.get("/api/wallet/history", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const rows = await db.select().from(walletLedger)
        .where(eq(walletLedger.userId, userId))
        .orderBy(desc(walletLedger.createdAt))
        .limit(20)
      res.json({ entries: rows })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Ganancias acumuladas del autor (para su perfil)
  app.get("/api/earnings/mine", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const rows = await db.select().from(authorEarnings)
        .where(eq(authorEarnings.authorUserId, userId))
      const accrued = rows.filter(r => r.status === "accrued")
      const totalCents = accrued.reduce((s, r) => s + r.authorCents, 0)
      res.json({
        currency:   rows[0]?.currency || "mxn",
        totalCents,
        count:      accrued.length,
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ESTADÍSTICAS PRIVADAS del autor: apoyos y retención de TODAS sus obras.
  // Solo el propio autor las ve (nunca visibles para otros).
  app.get("/api/author/stats", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      // Obras del autor
      const allBooks = await db.select().from(books).where(eq(books.authorId, userId))
      const bookIds = allBooks.map(b => b.id)
      if (bookIds.length === 0) {
        return res.json({ totalHearts: 0, totalSupports: 0, totalReaders: 0, perBook: [] })
      }

      // Apoyos por obra
      const allSupports = await db.select().from(unlockedBooks)
        .where(and(inArray(unlockedBooks.bookId, bookIds), eq(unlockedBooks.source, "support")))
      // Lecturas por obra (readingProgress guarda bookId como texto)
      const allProgress = await db.select().from(readingProgress)
        .where(inArray(readingProgress.bookId, bookIds.map(String)))

      let totalHearts = 0, totalSupports = 0, totalReaders = 0
      const perBook = allBooks.map(b => {
        const total = Array.isArray(b.chapters) ? b.chapters.length : 1
        const sup = allSupports.filter(s => s.bookId === b.id).length
        const prog = allProgress.filter(p => p.bookId === String(b.id))
        const readers = prog.length
        const finishers = prog.filter(p => total > 0 && p.maxChapter >= Math.max(1, total - 1)).length
        const hearts = finishers * 4 + sup * 3 + Math.max(0, readers - finishers)
        totalHearts += hearts; totalSupports += sup; totalReaders += readers
        return { bookId: b.id, title: b.title, hearts, supports: sup, readers, finishers }
      }).sort((a, b) => b.hearts - a.hearts)

      res.json({ totalHearts, totalSupports, totalReaders, perBook })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // EJEMPLARES COMERCIALES del usuario. Un permiso de venta pertenece a
  // quien lo adquirió, no necesariamente al autor de la obra. Nunca se revela
  // la identidad de quien reclamó la copia digital ni la clave impresa.
  app.get("/api/author/editions", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id as number
      const tokens = await db.select().from(bookTokens).where(and(
        eq(bookTokens.ownerUserId, userId), eq(bookTokens.kind, "sale"),
      ))
      const tokenIds = tokens.map(token => token.id)
      const bookIds = [...new Set(tokens.map(token => token.bookId))]
      const [copyRows, bookRows] = await Promise.all([
        tokenIds.length ? db.select().from(printCopies).where(inArray(printCopies.tokenId, tokenIds)) : [],
        bookIds.length ? db.select({
          id: books.id, title: books.title, author: books.author, coverUrl: books.coverUrl,
        }).from(books).where(inArray(books.id, bookIds)) : [],
      ])
      const bookById = new Map(bookRows.map(book => [book.id, book]))
      const tokenById = new Map(tokens.map(token => [token.id, token]))
      const editions = copyRows.map(copy => {
        const token = tokenById.get(copy.tokenId)!
        const { claimKey: _claimKey, claimedByUserId, ...safeCopy } = copy
        return {
          ...safeCopy,
          book: bookById.get(token.bookId) || null,
          digitalClaimed: claimedByUserId != null,
        }
      }).sort((a, b) => b.id - a.id)
      res.setHeader("Cache-Control", "no-store")
      res.json({
        editions,
        summary: {
          total: editions.length,
          available: editions.filter(copy => copy.saleStatus === "available").length,
          sold: editions.filter(copy => copy.saleStatus === "sold").length,
          returned: editions.filter(copy => copy.saleStatus === "returned").length,
          digitalClaimed: editions.filter(copy => copy.digitalClaimed).length,
        },
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "No se pudieron cargar los ejemplares" })
    }
  })

  const commercialCopyUpdate = z.object({
    status: z.enum(["available", "sold", "returned"]),
    priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    channel: z.string().trim().max(80).optional().default(""),
    note: z.string().trim().max(300).optional().default(""),
  })

  app.patch("/api/author/editions/:copyId", rateLimit(60_000, 30), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const copyId = Number(req.params.copyId)
      if (!Number.isInteger(copyId) || copyId <= 0) return res.status(400).json({ message: "Ejemplar inválido" })
      const input = commercialCopyUpdate.parse(req.body)
      const userId = (req.user as any).id as number
      const [copy] = await db.select().from(printCopies).where(eq(printCopies.id, copyId))
      if (!copy) return res.status(404).json({ message: "Ejemplar no encontrado" })
      const [token] = await db.select().from(bookTokens).where(eq(bookTokens.id, copy.tokenId))
      if (!token || token.kind !== "sale") return res.status(404).json({ message: "Permiso comercial no encontrado" })
      if (token.ownerUserId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "No puedes administrar este ejemplar" })
      }
      const now = new Date()
      const [updated] = await db.transaction(async tx => {
        const [row] = await tx.update(printCopies).set({
          saleStatus: input.status,
          soldAt: input.status === "sold" ? (copy.soldAt || now) : input.status === "available" ? null : copy.soldAt,
          salePriceCents: input.status === "sold" ? (input.priceCents ?? copy.salePriceCents) : copy.salePriceCents,
          saleChannel: input.channel,
          saleNote: input.note,
          updatedAt: now,
        }).where(eq(printCopies.id, copyId)).returning()
        await tx.insert(printCopyEvents).values({
          copyId, actorUserId: userId,
          eventType: input.status === "sold" ? "marked_sold" : input.status === "returned" ? "marked_returned" : "marked_available",
          metadata: { priceCents: input.priceCents ?? null, channel: input.channel, note: input.note },
        })
        return [row]
      })
      const { claimKey: _claimKey, claimedByUserId, ...safeCopy } = updated
      res.json({ ...safeCopy, digitalClaimed: claimedByUserId != null })
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message || "Datos inválidos" })
      res.status(500).json({ message: err.message || "No se pudo actualizar el ejemplar" })
    }
  })

  // Buzón transaccional: solo lectura/estado. La mensajería directa permanece
  // cerrada hasta contar con bloqueo, silencio, reportes y moderación.
  app.get("/api/notifications", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id as number
      const rows = await db.select().from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt)).limit(50)
      res.setHeader("Cache-Control", "no-store")
      res.json({ notifications: rows, unread: rows.filter(row => !row.readAt).length })
    } catch {
      res.status(500).json({ message: "No se pudo cargar el buzón" })
    }
  })

  app.patch("/api/notifications/:id/read", rateLimit(60_000, 60), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const id = Number(req.params.id)
      const userId = (req.user as any).id as number
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Notificación inválida" })
      const [updated] = await db.update(notifications).set({ readAt: new Date() }).where(and(
        eq(notifications.id, id), eq(notifications.userId, userId),
      )).returning({ id: notifications.id })
      if (!updated) return res.status(404).json({ message: "Notificación no encontrada" })
      res.json({ ok: true })
    } catch {
      res.status(500).json({ message: "No se pudo actualizar el buzón" })
    }
  })

  app.post("/api/notifications/read-all", rateLimit(60_000, 12), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id as number
      await db.update(notifications).set({ readAt: new Date() }).where(and(
        eq(notifications.userId, userId), sql`${notifications.readAt} IS NULL`,
      ))
      res.json({ ok: true })
    } catch {
      res.status(500).json({ message: "No se pudo actualizar el buzón" })
    }
  })

  // MIS tokens (con sus ejemplares) para un libro
  app.get("/api/tokens/mine", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.query.bookId)
      if (isNaN(bookId)) return res.status(400).json({ message: "Falta bookId" })

      const tokens = await db.select().from(bookTokens)
        .where(and(eq(bookTokens.bookId, bookId), eq(bookTokens.ownerUserId, userId)))
      const tokenIds = tokens.map(token => token.id)
      const copies = tokenIds.length
        ? await db.select().from(printCopies).where(inArray(printCopies.tokenId, tokenIds))
        : []
      const copiesByToken = new Map<number, typeof copies>()
      for (const copy of copies) {
        const group = copiesByToken.get(copy.tokenId) || []
        group.push(copy)
        copiesByToken.set(copy.tokenId, group)
      }
      const out = tokens.map(token => ({
        ...token,
        copies: (copiesByToken.get(token.id) || []).map(copy => {
          const { claimedByUserId, ...safeCopy } = copy
          return {
            ...safeCopy,
            digitalClaimed: claimedByUserId != null,
            claimedByOwner: claimedByUserId === userId,
          }
        }),
      }))
      res.json({ tokens: out })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // INFO pública de un ejemplar (lo que ve quien escanea el QR)
  app.get("/api/claim/:folio", async (req, res) => {
    try {
      const folio = String(req.params.folio || "").toUpperCase().slice(0, 20)
      const [copy] = await db.select().from(printCopies).where(eq(printCopies.folio, folio))
      if (!copy) return res.status(404).json({ message: "Folio no encontrado" })

      const [token] = await db.select().from(bookTokens).where(eq(bookTokens.id, copy.tokenId))
      const book = token ? await storage.getBook(token.bookId) : null
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })

      const me = req.isAuthenticated() ? (req.user as any).id : null
      const status = !copy.claimedByUserId ? "free"
        : copy.claimedByUserId === me ? "yours"
        : "taken"

      res.json({
        folio,
        status,                               // free | yours | taken
        kind:   token!.kind,
        bookId: book.id,
        title:  book.title,
        author: book.author,
        coverUrl: book.coverUrl || "",
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // RECLAMAR un ejemplar con su clave (folio + clave = reclamo único)
  app.post("/api/claim/:folio", rateLimit(60_000, 10), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión para reclamar" })
      const userId = (req.user as any).id
      const folio  = String(req.params.folio || "").toUpperCase().slice(0, 20)
      const key    = String(req.body?.key || "").toUpperCase().replace(/\s/g, "").slice(0, 20)

      const result = await db.transaction(async (tx) => {
        const [copy] = await tx.select().from(printCopies).where(eq(printCopies.folio, folio))
        if (!copy) return { state: "missing" as const }
        await tx.execute(sql`select pg_advisory_xact_lock(74001, ${copy.id})`)
        const [fresh] = await tx.select().from(printCopies).where(eq(printCopies.id, copy.id))
        if (!fresh) return { state: "missing" as const }
        if (fresh.claimedByUserId && fresh.claimedByUserId !== userId) {
          return { state: "taken" as const }
        }
        const normalizedStored = fresh.claimKey.toUpperCase().replace(/\s/g, "")
        const sameSecret = (candidate: string, expected: string) => {
          const left = Buffer.from(candidate, "utf8")
          const right = Buffer.from(expected, "utf8")
          return left.length === right.length && timingSafeEqual(left, right)
        }
        if (!sameSecret(key, normalizedStored) && !sameSecret(key, normalizedStored.replace(/-/g, ""))) {
          return { state: "key" as const }
        }
        const [token] = await tx.select().from(bookTokens).where(eq(bookTokens.id, fresh.tokenId))
        if (!token) return { state: "token" as const }
        if (!fresh.claimedByUserId) {
          const [claimed] = await tx.update(printCopies)
            .set({ claimedByUserId: userId, claimedAt: new Date() })
            .where(and(eq(printCopies.id, fresh.id), sql`${printCopies.claimedByUserId} IS NULL`))
            .returning({ id: printCopies.id })
          if (!claimed) return { state: "taken" as const }
          if (token.ownerUserId !== userId) {
            const [claimedBook] = await tx.select({ title: books.title }).from(books).where(eq(books.id, token.bookId))
            await tx.insert(notifications).values({
              userId: token.ownerUserId,
              kind: "copy_claimed",
              title: claimedBook?.title || "Tloque",
              body: fresh.folio,
              destination: "/editions",
              dedupeKey: `copy-claimed:${fresh.id}`,
            }).onConflictDoNothing()
          }
        }
        await ensureUnlock(userId, token.bookId, "claim", tx)
        return { state: "ok" as const, bookId: token.bookId }
      })

      if (result.state === "missing") return res.status(404).json({ message: "Folio no encontrado" })
      if (result.state === "taken") return res.status(409).json({ message: "taken" })
      if (result.state === "key") return res.status(403).json({ message: "Clave incorrecta" })
      if (result.state === "token") return res.status(404).json({ message: "Token no encontrado" })
      res.json({ ok: true, bookId: result.bookId })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error al reclamar" })
    }
  })

  // Libros desbloqueados del usuario (no cuentan para el límite; re-descargables)
  app.get("/api/tokens/unlocked", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const rows = await db.select().from(unlockedBooks).where(eq(unlockedBooks.userId, userId))
      res.json({ bookIds: rows.map(r => r.bookId) })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ════════════════════════════════════════════════════════
  // TARJETAS COLECCIONABLES — sin azar (ley de diseño)
  // ════════════════════════════════════════════════════════

  async function canUseCardFrame(userId: number, frameId: number | null, admin: boolean, currentFrameId?: number | null) {
    if (!frameId) return true
    const [frame] = await db.select().from(frames).where(eq(frames.id, frameId))
    if (!frame || (frame.target !== "card" && frame.target !== "both")) return false
    if (admin || frame.priceTinta <= 0 && frame.visible || currentFrameId === frameId) return true
    const [owned] = await db.select().from(userFrames).where(and(
      eq(userFrames.userId, userId), eq(userFrames.frameId, frameId),
    ))
    return !!owned
  }

  // Tarjetas de una obra + cuáles posee el usuario. Si ya apoyó la
  // obra, las "support" pendientes se le otorgan aquí mismo (perezoso
  // e idempotente: cubre también tarjetas creadas DESPUÉS de su apoyo).
  app.get("/api/books/:id/cards", async (req, res) => {
    try {
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })
      const book = await storage.getBook(bookId)
      if (!book || !canViewBook(req, book)) return res.status(404).json({ message: "Libro no encontrado" })
      const cards = await db.select().from(bookCards)
        .where(eq(bookCards.bookId, bookId))
        .orderBy(bookCards.position, bookCards.id)

      let ownedIds = new Set<number>()
      if (req.isAuthenticated() && cards.length > 0) {
        const userId = (req.user as any).id
        const [unlocked] = await db.select().from(unlockedBooks)
          .where(and(
            eq(unlockedBooks.userId, userId),
            eq(unlockedBooks.bookId, bookId),
            eq(unlockedBooks.source, "support"),
          ))
        if (unlocked) {
          const pending = cards
            .filter(card => card.unlock === "support")
            .map(card => ({ userId, cardId: card.id, source: "support" }))
          if (pending.length) {
            await db.insert(userCards).values(pending).onConflictDoNothing()
          }
        }
        const mine = await db.select().from(userCards)
          .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, cards.map(c => c.id))))
        ownedIds = new Set(mine.map(m => m.cardId))
      }
      res.json({ cards: cards.map(c => ({ ...c, owned: ownedIds.has(c.id) })) })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // MI COLECCIÓN: todas las tarjetas que el usuario posee, agrupadas por obra.
  // Antes, otorga perezosamente las "support" de obras que ya apoyó (cubre
  // tarjetas creadas después del apoyo, en cualquier obra de su biblioteca).
  app.get("/api/cards/collection", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      // Otorgar pendientes: por cada obra desbloqueada, sus tarjetas "support"
      const unlocked = await db.select().from(unlockedBooks).where(and(
        eq(unlockedBooks.userId, userId),
        eq(unlockedBooks.source, "support"),
      ))
      const unlockedBookIds = unlocked.map(u => u.bookId)
      if (unlockedBookIds.length > 0) {
        const supportCards = await db.select().from(bookCards)
          .where(and(inArray(bookCards.bookId, unlockedBookIds), eq(bookCards.unlock, "support")))
        if (supportCards.length) {
          await db.insert(userCards)
            .values(supportCards.map(card => ({ userId, cardId: card.id, source: "support" })))
            .onConflictDoNothing()
        }
      }

      // Traer las tarjetas que posee, con datos de la tarjeta
      const owned = await db.select().from(userCards).where(eq(userCards.userId, userId))
      if (owned.length === 0) return res.json({ groups: [], total: 0 })
      const ownedCardIds = owned.map(o => o.cardId)
      const cards = (await db.select().from(bookCards)
        .where(inArray(bookCards.id, ownedCardIds))
        .orderBy(bookCards.bookId, bookCards.position, bookCards.id))
        .filter(card => card.bookId != null)

      // Agrupar por obra (con título)
      const byBook = new Map<number, any[]>()
      for (const c of cards) {
        if (c.bookId == null) continue
        if (!byBook.has(c.bookId)) byBook.set(c.bookId, [])
        byBook.get(c.bookId)!.push({ ...c, owned: true })
      }
      const bookIds = [...byBook.keys()]
      const groupBooks = bookIds.length
        ? await db.select({ id: books.id, title: books.title, author: books.author })
          .from(books).where(inArray(books.id, bookIds))
        : []
      const booksById = new Map(groupBooks.map(book => [book.id, book]))
      const groups = []
      for (const [bookId, groupCards] of byBook) {
        const book = booksById.get(bookId)
        groups.push({
          bookId,
          bookTitle: book?.title || "Obra",
          author:    book?.author || "",
          cards:     groupCards,
        })
      }
      res.json({ groups, total: cards.length })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Comprar una tarjeta con Tinta (precio visible; débito atómico)
  app.post("/api/cards/:id/buy", rateLimit(60_000, 10), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
      if (isNaN(cardId)) return res.status(400).json({ message: "ID inválido" })
      const [card] = await db.select().from(bookCards).where(eq(bookCards.id, cardId))
      if (!card) return res.status(404).json({ message: "Tarjeta no encontrada" })
      if (card.bookId == null) return res.status(400).json({ message: "La tarjeta debe pertenecer a una obra" })
      const book = await storage.getBook(card.bookId)
      if (!book || book.status !== "published") return res.status(404).json({ message: "Tarjeta no encontrada" })
      if (card.unlock !== "tinta") {
        return res.status(400).json({ message: "Esta tarjeta se obtiene apoyando la obra" })
      }
      const cost = card.priceTinta
      if (!Number.isInteger(cost) || cost < CARD_PRICE_MIN || cost > CARD_PRICE_MAX) {
        return res.status(409).json({ message: "La tarjeta tiene un precio inválido y no puede comprarse" })
      }
      const purchase = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const [already] = await tx.select().from(userCards)
          .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
        if (already) return { state: "owned" as const }
        const [order] = await tx.insert(tokenOrders).values({
          userId, bookId: card.bookId!, kind: "card",
          amountCents: cost * TINTA_CENTS, currency: "mxn",
          status: "pending", provider: "tinta",
        }).returning()
        const r: any = await tx.execute(sql`
          insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
          select ${userId}, 'tinta', ${-cost}, 'spend_card', 'token_order', ${order.id}
          where (select coalesce(sum(delta), 0) from wallet_ledger
                 where user_id = ${userId} and currency = 'tinta') >= ${cost}
          returning id
        `)
        if ((r?.rows?.length ?? 0) === 0) {
          await tx.update(tokenOrders).set({ status: "failed" }).where(eq(tokenOrders.id, order.id))
          return { state: "funds" as const }
        }
        await tx.insert(userCards).values({ userId, cardId, source: "tinta" })
        // Comprar una tarjeta incluye la obra: la carta no es un adorno
        // separado, sino la edición coleccionable de esa lectura.
        await ensureUnlock(userId, card.bookId!, "card", tx)
        await tx.update(tokenOrders).set({ status: "paid", paidAt: new Date() })
          .where(eq(tokenOrders.id, order.id))
        await settleEarnings(order, AUTHOR_SHARE_STORY, tx)
        return { state: "paid" as const }
      })
      if (purchase.state === "owned") return res.status(409).json({ message: "Ya está en tu colección" })
      if (purchase.state === "funds") {
        const balance = await walletBalance(userId, "tinta")
        return res.status(402).json({ message: "tinta_insuficiente", needed: cost, balance })
      }
      return res.status(201).json({ ok: true, cardId })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Crear tarjeta (solo el autor; máximo 6 por obra)
  app.post("/api/books/:id/cards", rateLimit(60_000, 12), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })
      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.status === "deleted") return res.status(404).json({ message: "Libro no encontrado" })
      if (book.authorId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo el autor puede crear tarjetas" })
      }
      const v = validateCard(req.body)
      if (!v.ok) return res.status(400).json({ message: v.message })
      if (!(await canUseCardFrame(userId, v.card.fx.frameId, isAdmin(req.user)))) {
        return res.status(403).json({ message: "No tienes acceso a ese marco" })
      }
      const card = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72001, ${bookId})`)
        const existing = await tx.select().from(bookCards).where(eq(bookCards.bookId, bookId))
        if (existing.length >= MAX_CARDS_PER_BOOK) return null
        const [created] = await tx.insert(bookCards)
          .values({ bookId, authorId: book.authorId, ...v.card, position: existing.length }).returning()
        return created
      })
      if (!card) return res.status(400).json({ message: `Máximo ${MAX_CARDS_PER_BOOK} tarjetas por obra` })
      res.status(201).json(card)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Editar tarjeta (solo el autor)
  app.put("/api/cards/:id", rateLimit(60_000, 30), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
      if (!Number.isInteger(cardId) || cardId <= 0) return res.status(400).json({ message: "ID inválido" })
      const [card] = await db.select().from(bookCards).where(eq(bookCards.id, cardId))
      if (!card) return res.status(404).json({ message: "Tarjeta no encontrada" })
      // Suelta: el dueño es authorId. Con libro: el dueño es el autor del libro.
      if (card.bookId == null) {
        if (card.authorId !== userId && !isAdmin(req.user)) {
          return res.status(403).json({ message: "Solo el autor puede editar tarjetas" })
        }
      } else {
        const book = await storage.getBook(card.bookId)
        if (!book || (book.authorId !== userId && !isAdmin(req.user))) {
          return res.status(403).json({ message: "Solo el autor puede editar tarjetas" })
        }
      }
      const v = validateCard(req.body)
      if (!v.ok) return res.status(400).json({ message: v.message })
      if (!(await canUseCardFrame(userId, v.card.fx.frameId, isAdmin(req.user), (card.fx as any)?.frameId))) {
        return res.status(403).json({ message: "No tienes acceso a ese marco" })
      }
      const [updated] = await db.update(bookCards).set(v.card)
        .where(eq(bookCards.id, cardId)).returning()
      res.json(updated)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Borrar tarjeta (solo el autor) — retira también las copias en colecciones
  app.delete("/api/cards/:id", rateLimit(60_000, 12), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
      if (!Number.isInteger(cardId) || cardId <= 0) return res.status(400).json({ message: "ID inválido" })
      const [card] = await db.select().from(bookCards).where(eq(bookCards.id, cardId))
      if (!card) return res.status(404).json({ message: "Tarjeta no encontrada" })
      if (card.bookId == null) {
        if (card.authorId !== userId && !isAdmin(req.user)) {
          return res.status(403).json({ message: "Solo el autor puede borrar tarjetas" })
        }
      } else {
        const book = await storage.getBook(card.bookId)
        if (!book || (book.authorId !== userId && !isAdmin(req.user))) {
          return res.status(403).json({ message: "Solo el autor puede borrar tarjetas" })
        }
      }
      await db.transaction(async (tx) => {
        await tx.delete(userCards).where(eq(userCards.cardId, cardId))
        // El historial del sorteo se conserva, pero deja de referenciar una
        // carta que el autor decidió retirar.
        await tx.update(gachaDraws).set({ cardId: null }).where(eq(gachaDraws.cardId, cardId))
        await tx.delete(bookCards).where(eq(bookCards.id, cardId))
      })
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── TARJETAS SUELTAS (creadas antes de tener libro) ────

  // Mis tarjetas sueltas
  app.get("/api/cards/loose", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const loose = await db.select().from(bookCards)
        .where(and(sql`${bookCards.bookId} IS NULL`, eq(bookCards.authorId, userId)))
        .orderBy(desc(bookCards.createdAt))
      res.json({ cards: loose })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Crear tarjeta suelta (sin libro todavía)
  app.post("/api/cards", rateLimit(60_000, 12), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const v = validateCard(req.body)
      if (!v.ok) return res.status(400).json({ message: v.message })
      if (!(await canUseCardFrame(userId, v.card.fx.frameId, isAdmin(req.user)))) {
        return res.status(403).json({ message: "No tienes acceso a ese marco" })
      }
      const card = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72002, ${userId})`)
        const existing = await tx.select().from(bookCards)
          .where(and(sql`${bookCards.bookId} IS NULL`, eq(bookCards.authorId, userId)))
        if (existing.length >= MAX_LOOSE_CARDS) return null
        const [created] = await tx.insert(bookCards)
          .values({ bookId: null, authorId: userId, ...v.card, position: existing.length }).returning()
        return created
      })
      if (!card) return res.status(400).json({ message: `Máximo ${MAX_LOOSE_CARDS} tarjetas sueltas` })
      res.status(201).json(card)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Asignar una tarjeta suelta a una obra propia
  app.post("/api/cards/:id/assign", rateLimit(60_000, 12), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
      const bookId = Number(req.body?.bookId)
      if (isNaN(cardId) || isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })
      const [card] = await db.select().from(bookCards).where(eq(bookCards.id, cardId))
      if (!card) return res.status(404).json({ message: "Tarjeta no encontrada" })
      if (card.bookId != null) return res.status(400).json({ message: "La tarjeta ya pertenece a una obra" })
      if (card.authorId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo el autor puede asignar sus tarjetas" })
      }
      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.status === "deleted") return res.status(404).json({ message: "Libro no encontrado" })
      if (book.authorId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo puedes asignar a tus propias obras" })
      }
      const updated = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72001, ${bookId})`)
        const [fresh] = await tx.select().from(bookCards).where(eq(bookCards.id, cardId))
        if (!fresh || fresh.bookId != null) return { state: "assigned" as const, card: null }
        const inBook = await tx.select().from(bookCards).where(eq(bookCards.bookId, bookId))
        if (inBook.length >= MAX_CARDS_PER_BOOK) return { state: "limit" as const, card: null }
        const [assigned] = await tx.update(bookCards)
          .set({ bookId, position: inBook.length })
          .where(and(eq(bookCards.id, cardId), sql`${bookCards.bookId} IS NULL`)).returning()
        return { state: "ok" as const, card: assigned }
      })
      if (updated.state === "assigned") return res.status(409).json({ message: "La tarjeta ya pertenece a una obra" })
      if (updated.state === "limit") return res.status(400).json({ message: `Máximo ${MAX_CARDS_PER_BOOK} tarjetas por obra` })
      res.json(updated.card)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── GALERÍA DE MARCOS (Taller) ─────────────────────────
  // El admin crea marcos en el taller; los autores los ven y desbloquean con Tinta.

  // Guardar un marco (solo admin). Llega del taller vía postMessage → FrameWorkshop.
  app.post("/api/admin/frames", requireAdmin, rateLimit(60_000, 20), async (req, res) => {
    try {
      const check = validateFrame(req.body)
      if (!check.ok) return res.status(400).json({ message: check.error })
      const userId = (req.user as any)?.id ?? null
      const [saved] = await db.insert(frames).values({
        name:          check.frame.name,
        priceTinta:    check.frame.priceTinta,
        target:        check.frame.target,
        schemaVersion: check.frame.schemaVersion,
        fingerprint:   check.frame.fingerprint,
        pkg:           check.frame.pkg,
        createdBy:     userId,
      }).returning()
      res.status(201).json({ frame: saved })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error al guardar el marco" })
    }
  })

  // Listar la galería. Marca cuáles tiene desbloqueados el usuario.
  // Los gratuitos (precio 0) están disponibles para todos.
  app.get("/api/frames", async (req, res) => {
    try {
      const list = await db.select().from(frames)
        .orderBy(desc(frames.createdAt))
      let ownedIds = new Set<number>()
      if (req.isAuthenticated()) {
        const userId = (req.user as any).id
        const mine = await db.select().from(userFrames).where(eq(userFrames.userId, userId))
        ownedIds = new Set(mine.map(m => m.frameId))
      }
      const visibleToUser = list.filter(frame =>
        frame.visible || ownedIds.has(frame.id) || (req.isAuthenticated() && isAdmin(req.user)))
      res.json({
        frames: visibleToUser.map(f => {
          const { createdBy: _createdBy, ...publicFrame } = f
          return {
            ...publicFrame,
            available: f.visible,
            owned: ownedIds.has(f.id) || (f.visible && f.priceTinta <= 0),
          }
        }),
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Desbloquear un marco con Tinta. Débito atómico contra el libro mayor
  // del monedero: si no alcanza, no se descuenta nada y se avisa cuánto falta.
  app.post("/api/frames/:id/buy", rateLimit(60_000, 10), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const frameId = Number(req.params.id)
      if (isNaN(frameId)) return res.status(400).json({ message: "ID inválido" })

      const [frame] = await db.select().from(frames)
        .where(and(eq(frames.id, frameId), eq(frames.visible, true)))
      if (!frame) return res.status(404).json({ message: "Marco no encontrado" })
      if (!Number.isInteger(frame.priceTinta) || frame.priceTinta < 0 || frame.priceTinta > 1_000) {
        return res.status(409).json({ message: "El marco tiene un precio inválido y no puede comprarse" })
      }

      const [already] = await db.select().from(userFrames)
        .where(and(eq(userFrames.userId, userId), eq(userFrames.frameId, frameId)))
      if (already) return res.status(409).json({ message: "Ya tienes este marco" })

      const cost = frame.priceTinta
      if (cost <= 0) {
        await db.insert(userFrames).values({ userId, frameId, source: "gift" })
          .onConflictDoNothing()
        return res.status(200).json({ ok: true, frameId, spent: 0 })
      }

      const purchase = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const [owned] = await tx.select().from(userFrames)
          .where(and(eq(userFrames.userId, userId), eq(userFrames.frameId, frameId)))
        if (owned) return { state: "owned" as const }
        const r: any = await tx.execute(sql`
          insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
          select ${userId}, 'tinta', ${-cost}, 'spend_frame', 'frame', ${frameId}
          where (select coalesce(sum(delta), 0) from wallet_ledger
                 where user_id = ${userId} and currency = 'tinta') >= ${cost}
          returning id
        `)
        if ((r?.rows?.length ?? 0) === 0) return { state: "funds" as const }
        await tx.insert(userFrames).values({ userId, frameId, source: "tinta" })
        return { state: "paid" as const }
      })

      if (purchase.state === "owned") return res.status(409).json({ message: "Ya tienes este marco" })
      if (purchase.state === "funds") {
        const balance = await walletBalance(userId, "tinta")
        return res.status(402).json({
          message: "tinta_insuficiente",
          needed: cost, balance, missing: Math.max(0, cost - balance),
        })
      }
      return res.status(201).json({ ok: true, frameId, spent: cost })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Retirar un marco de la galería (solo admin). No borra: lo oculta,
  // para no romper los desbloqueos ya comprados.
  app.delete("/api/admin/frames/:id", requireAdmin, rateLimit(60_000, 20), async (req, res) => {
    try {
      const frameId = Number(req.params.id)
      if (isNaN(frameId)) return res.status(400).json({ message: "ID inválido" })
      await db.update(frames).set({ visible: false }).where(eq(frames.id, frameId))
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── EL SORTEO ──────────────────────────────────────────
  // Nace dormido. El admin lo enciende el día del lanzamiento.

  // Estado público: probabilidades a la vista, el pozo, y la piedad del lector.
  // Las probabilidades SIEMPRE son públicas: es lo que separa una casa seria
  // de una trampa.
  app.get("/api/gacha/status", async (req, res) => {
    try {
      const [cfg] = await db.select().from(gachaConfig).where(eq(gachaConfig.id, 1))
      const enabled = !!cfg?.enabled
      const pool = cfg?.poolBalance ?? 0

      // Cuántas obras hay por rareza (stock real, sin mentir)
      const stock: any = await db.execute(sql`
        select c.rarity, count(distinct c.book_id) as obras, count(*) as cartas
        from book_cards c join books b on b.id = c.book_id
        where c.in_gacha_pool = true and b.status = 'published' and c.book_id is not null
        group by c.rarity
      `)
      const byRarity: Record<string, { obras: number; cartas: number }> = {}
      for (const r of (stock?.rows ?? [])) {
        byRarity[r.rarity] = { obras: Number(r.obras), cartas: Number(r.cartas) }
      }

      const tiers = RARITIES.map(r => ({
        key: r.key, name: r.name,
        probability: r.prob,
        bonusToAuthor: r.bonus,
        obras: byRarity[r.key]?.obras ?? 0,
        cartas: byRarity[r.key]?.cartas ?? 0,
        // El jackpot progresivo: ¿el pozo ya puede honrar esta rareza?
        poolUnlocked: pool >= r.bonus,
        poolProgress: Math.min(1, pool / r.bonus),
      }))

      let pity = null
      if (req.isAuthenticated()) {
        const userId = (req.user as any).id
        const [p] = await db.select().from(gachaPity).where(eq(gachaPity.userId, userId))
        const sg = p?.sinceGolden ?? 0, sl = p?.sinceLegendary ?? 0
        pity = { ...pityCountdown(sg, sl), sinceGolden: sg, sinceLegendary: sl,
                 totalDraws: p?.totalDraws ?? 0,
                 everyGolden: PITY.golden.every, everyLegendary: PITY.legendary.every }
      }

      res.json({
        enabled, pool, ticket: TICKET, tiers, pity,
        poolStatus: poolStatus(pool),
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // UNA TIRADA.
  app.post("/api/gacha/draw", rateLimit(60_000, 40), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const out = await drawTicket(userId)
      if (!out.ok) {
        return res.status(out.code).json({ message: out.message, ...(out.extra || {}) })
      }
      res.status(201).json(out.result)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error en el sorteo" })
    }
  })

  // Historial de tiradas del lector (transparencia total).
  app.get("/api/gacha/history", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const rows = await db.select().from(gachaDraws)
        .where(eq(gachaDraws.userId, userId))
        .orderBy(desc(gachaDraws.createdAt)).limit(50)
      res.json({ draws: rows })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Los géneros que el lector NO quiere que le toquen (máximo 3).
  app.post("/api/gacha/exclusions", rateLimit(60_000, 20), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const raw = Array.isArray(req.body?.genres) ? req.body.genres : []
      const genres = [...new Set(raw
        .filter((g: any) => typeof g === "string")
        .map((g: string) => g.trim().slice(0, 60))
        .filter(Boolean))].slice(0, 3)
      await db.execute(sql`
        insert into gacha_exclusions (user_id, genres, updated_at)
        values (${userId}, ${JSON.stringify(genres)}::jsonb, now())
        on conflict (user_id) do update set genres = ${JSON.stringify(genres)}::jsonb, updated_at = now()
      `)
      res.json({ genres })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── EL INTERRUPTOR (solo admin) ──
  app.post("/api/admin/gacha/toggle", requireAdmin, rateLimit(60_000, 20), async (req, res) => {
    try {
      const enabled = req.body?.enabled === true
      await db.insert(gachaConfig).values({ id: 1, enabled })
        .onConflictDoUpdate({
          target: gachaConfig.id,
          set: { enabled, updatedAt: new Date() },
        })
      res.json({ enabled })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Auditoría del sorteo (solo admin): ¿el dinero cierra?
  app.get("/api/admin/gacha/audit", requireAdmin, async (_req, res) => {
    try {
      const a: any = await db.execute(sql`
        select
          count(*)                        as tiradas,
          coalesce(sum(ticket_price), 0)  as recaudado,
          coalesce(sum(paid_direct), 0)   as directo_autores,
          coalesce(sum(bonus_from_pool),0)as bonos_autores,
          coalesce(sum(paid_house), 0)    as tloque,
          coalesce(sum(paid_pool), 0)     as entro_al_pozo
        from gacha_draws
      `)
      const r = a?.rows?.[0] ?? {}
      const [cfg] = await db.select().from(gachaConfig).where(eq(gachaConfig.id, 1))
      const recaudado = Number(r.recaudado || 0)
      const aAutores = Number(r.directo_autores || 0) + Number(r.bonos_autores || 0)
      const aTloque = Number(r.tloque || 0)
      const pozo = cfg?.poolBalance ?? 0
      const fuga = recaudado - (aAutores + aTloque + pozo)
      res.json({
        tiradas: Number(r.tiradas || 0),
        recaudado, aAutores, aTloque, pozo,
        fuga,                                   // DEBE ser 0
        cierraContabilidad: fuga === 0,
        porcentajeAutores: recaudado ? (aAutores + pozo) / recaudado : 0,
        porcentajeTloque: recaudado ? aTloque / recaudado : 0,
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── LA RAREZA SE GANA ──────────────────────────────────

  // Recalcular el score de todas las obras (admin, o un cron).
  app.post("/api/admin/gacha/recompute-scores", requireAdmin, rateLimit(60_000, 4), async (_req, res) => {
    try {
      const scores = await computeAllScores()
      res.json({ obras: scores.length, scores: scores.slice(0, 100) })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // La escalera de esta obra: en qué escalón está, qué desbloqueó, qué le falta.
  app.get("/api/books/:id/rarity-info", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const [book] = await db.select().from(books).where(eq(books.id, bookId))
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })
      if (book.authorId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo el autor" })
      }

      // El percentil vive en el score; el tamaño, en el tipo de obra.
      const score = Number((book as any).gachaScore ?? 0)
      const bookType = book.type || "book"
      const quotas = quotasFor(score, bookType)
      const rung = rungFor(score)

      const usadas: any = await db.execute(sql`
        select rarity, count(*) as n from book_cards
        where book_id = ${bookId} and in_gacha_pool = true group by rarity
      `)
      const enUso: Record<string, number> = {}
      for (const r of (usadas?.rows ?? [])) enUso[r.rarity] = Number(r.n)

      const rarities = RARITIES.map(r => {
        const quota = quotas[r.key] ?? 0
        const used = enUso[r.key] ?? 0
        return {
          key: r.key, name: r.name,
          quota, used,
          allowed: quota > 0 && used < quota,
          locked: quota === 0,
          bonusToAuthor: r.bonus,
          probability: r.prob,
        }
      })

      // El siguiente escalón: qué desbloquea, y cuánto falta
      const idx = LADDER.findIndex(l => l.name === rung.name)
      const next = idx >= 0 && idx < LADDER.length - 1 ? LADDER[idx + 1] : null

      res.json({
        bookId, title: book.title, type: bookType,
        typeScale: TYPE_SCALE[bookType] ?? 1,
        score, rung: rung.name,
        nextRung: next ? { name: next.name, minPct: next.minPct, needs: next.minPct - score } : null,
        ladder: LADDER.map(l => ({ name: l.name, minPct: l.minPct, quotas: l.quotas })),
        rarities,
      })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Poner (o quitar) una carta del sorteo, con su rareza.
  // La rareza se VALIDA contra lo que la obra se ganó: no se puede inventar.
  app.put("/api/cards/:id/gacha", rateLimit(60_000, 30), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
      if (isNaN(cardId)) return res.status(400).json({ message: "ID inválido" })

      const [card] = await db.select().from(bookCards).where(eq(bookCards.id, cardId))
      if (!card) return res.status(404).json({ message: "Tarjeta no encontrada" })
      if (card.bookId == null) {
        return res.status(400).json({ message: "Una tarjeta suelta no puede entrar al sorteo: asígnala a una obra primero" })
      }
      const [book] = await db.select().from(books).where(eq(books.id, card.bookId))
      if (!book || (book.authorId !== userId && !isAdmin(req.user))) {
        return res.status(403).json({ message: "Solo el autor" })
      }
      if (book.status !== "published") {
        return res.status(400).json({ message: "La obra debe estar publicada" })
      }

      const inPool = req.body?.inPool === true
      if (!inPool) {
        await db.update(bookCards).set({ inGachaPool: false }).where(eq(bookCards.id, cardId))
        return res.json({ inGachaPool: false })
      }

      const rarity = String(req.body?.rarity || "common") as any
      if (!RARITIES.some(r => r.key === rarity)) {
        return res.status(400).json({ message: "Rareza inválida" })
      }

      const update = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(73001, ${card.bookId!})`)
        // Cuántas de esa rareza ya tiene la obra (sin contar esta misma).
        // El candado impide que dos cambios simultáneos excedan el cupo.
        const usadas: any = await tx.execute(sql`
          select count(*) as n from book_cards
          where book_id = ${card.bookId!} and in_gacha_pool = true
            and rarity = ${rarity} and id <> ${cardId}
        `)
        const yaHay = Number(usadas?.rows?.[0]?.n ?? 0)
        const chk = canUseRarity(
          rarity,
          Number((book as any).gachaScore ?? 0),
          book.type || "book",
          yaHay,
        )
        if (!chk.ok) return chk
        await tx.update(bookCards)
          .set({ inGachaPool: true, rarity })
          .where(eq(bookCards.id, cardId))
        return { ok: true as const }
      })
      if (!update.ok) return res.status(403).json({ message: update.why })
      res.json({ inGachaPool: true, rarity })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── BETA DE ADMIN: probar el sorteo entero sin usuarios reales ──
  // Enciende el sistema, siembra un catálogo de prueba y regala Tinta.
  // Todo lo sembrado queda marcado para poder borrarlo de un tirón.
  app.post("/api/admin/gacha/beta", requireAdmin, rateLimit(60_000, 4), async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_GACHA_BETA_ADMIN !== "true") {
        return res.status(403).json({ message: "La beta administrativa está desactivada en producción" })
      }
      const userId = (req.user as any).id
      const action = String(req.body?.action || "setup")

      if (action === "setup") {
        // 1–2. Encender el sorteo y sembrar el pozo, aunque la fila inicial
        // todavía no exista en una instalación recién migrada.
        const seedPool = Math.max(0, Math.min(100_000, Math.round(Number(req.body?.pool) || 20_000)))
        await db.insert(gachaConfig).values({ id: 1, enabled: true, poolBalance: seedPool })
          .onConflictDoUpdate({
            target: gachaConfig.id,
            set: { enabled: true, poolBalance: seedPool, updatedAt: new Date() },
          })

        // 3. Regalar Tinta al admin para poder tirar
        const tinta = Math.max(0, Math.min(20_000, Math.round(Number(req.body?.tinta) || 4_000)))
        const [priorGrant] = await db.select().from(walletLedger).where(and(
          eq(walletLedger.userId, userId),
          eq(walletLedger.reason, "grant"),
          eq(walletLedger.refType, "admin_beta"),
        ))
        if (!priorGrant && tinta > 0) {
          await db.insert(walletLedger).values({
            userId, currency: "tinta", delta: tinta,
            reason: "grant", refType: "admin_beta", refId: 0,
          })
        }

        // 4. Poner TODAS las cartas existentes en el sorteo, repartidas por rareza
        //    (solo en beta: en producción la rareza se gana)
        const cartas = await db.select().from(bookCards)
          .where(sql`${bookCards.bookId} is not null`)
        const keys = RARITIES.map(r => r.key)
        let i = 0
        for (const c of cartas) {
          const rar = keys[i % keys.length]   // reparte en abanico para ver todas
          await db.update(bookCards)
            .set({ inGachaPool: true, rarity: rar })
            .where(eq(bookCards.id, c.id))
          i++
        }

        const [cfg] = await db.select().from(gachaConfig).where(eq(gachaConfig.id, 1))
        return res.json({
          ok: true, mode: "beta",
          enabled: cfg?.enabled, pool: cfg?.poolBalance,
          tintaGranted: tinta, cardsInPool: cartas.length,
          message: `Beta lista: ${cartas.length} cartas en el sorteo, pozo de ${seedPool} Tinta, ${tinta} Tinta para ti.`,
        })
      }

      if (action === "teardown") {
        if (req.body?.confirm !== "RESET_GACHA_BETA") {
          return res.status(400).json({ message: "Falta confirmación para apagar la beta" })
        }
        await db.update(gachaConfig)
          .set({ enabled: false, poolBalance: 0, updatedAt: new Date() })
          .where(eq(gachaConfig.id, 1))
        await db.update(bookCards).set({ inGachaPool: false })
        // Los historiales económicos y de piedad son auditables: nunca se borran.
        return res.json({ ok: true, mode: "off", message: "Beta apagada; el historial se conservó." })
      }

      return res.status(400).json({ message: "action debe ser setup o teardown" })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  return httpServer;
}
