import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { requireAdmin, isAdmin } from "./auth";
import { db } from "./db";
import { admins, books, users, comments, authorProfiles, userState, readingProgress, savedBooks, bookTokens, printCopies, unlockedBooks, tokenOrders, authorEarnings, walletLedger, walletOrders, bookCards, userCards, frames, userFrames, gachaConfig, gachaPity, gachaDraws, gachaExclusions, insertCommentSchema } from "@shared/schema";
import { randomBytes } from "crypto";
import { rateLimit } from "./rateLimit";
import { validateCard, MAX_CARDS_PER_BOOK } from "./cards";
import { validateFrame } from "./frames";
import { drawTicket } from "./gachaEngine";
import { computeAllScores, canUseRarity, quotasFor, rungFor, LADDER, TYPE_SCALE } from "./rarity";
import { RARITIES, TICKET, PITY, pityCountdown, poolStatus } from "@shared/gacha";
import { PRICES, TINTA_PACKS, TINTA_CENTS, AUTHOR_SHARE_STORY, AUTHOR_SHARE_BOOK, priceFor, isStory, stripeEnabled, createCheckoutSession, verifyStripeWebhook, splitEarnings } from "./payments";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import {
  searchGutenberg,
  processGutenbergBook,
  translateText,
} from "./gutenberg";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── GET /api/books ────────────────────────────────────
  app.get(api.books.list.path, async (req, res) => {
    try {
      const books = await storage.getBooks();
      res.json(books);
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
      if (book.status !== "published") {
        const userIsAdmin = req.isAuthenticated() && isAdmin(req.user);
        const userId  = req.isAuthenticated() ? (req.user as any)?.id : null;
        const isOwner = !!book.authorId && book.authorId === userId;
        if (!userIsAdmin && !isOwner) {
          return res.status(404).json({ message: "Book not found" });
        }
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

      res.json({ ...book, authorAvatar, authorFrame });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch book" });
    }
  });

  // ── POST /api/books ───────────────────────────────────
  // Asocia el libro al usuario autenticado si hay sesión activa
  app.post(api.books.create.path, async (req, res) => {
    try {
      // Publicar requiere sesión (evita spam anónimo al catálogo)
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Inicia sesión para publicar" });
      }
      const input = api.books.create.input.parse(req.body);

      // El autor es SIEMPRE quien está en la sesión (no se acepta del body)
      const authorId = (req.user as any)?.id ?? null;

      const book = await storage.createBook({
        ...input,
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
  app.put(api.books.update.path, async (req, res) => {
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

      const updated = await storage.updateBook(id, input);
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
  app.delete(api.books.delete.path, async (req, res) => {
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

      const user = req.user as any
      const created = await storage.createComment({
        bookId,
        chapterIndex: parsed.data.chapterIndex ?? 0,
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
  app.patch("/api/comments/:id/status", async (req, res) => {
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
  app.patch("/api/books/:id/comments-enabled", async (req, res) => {
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

  app.get("/api/gutenberg/search", async (req, res) => {
    try {
      const query      = String(req.query.q || "").trim()
      const searchLang = String(req.query.lang || "es")
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

  app.get("/api/gutenberg/preview/:id", async (req, res) => {
    try {
      const gutId       = Number(req.params.id)
      const previewLang = String(req.query.lang || "es")
      if (!gutId || isNaN(gutId)) return res.status(400).json({ message: "ID inválido" })

      // Si ya está en el catálogo, devolver ese
      const existing     = await storage.getBooks()
      const existingBook = existing.find((b: any) => b.gutenbergId === gutId)
      if (existingBook) {
        return res.json({ ...existingBook, existingBookId: existingBook.id, alreadyImported: true })
      }

      const searchRes = await fetch(`https://gutendex.com/books/${gutId}`)
      if (!searchRes.ok) return res.status(404).json({ message: "Libro no encontrado" })
      const book      = await searchRes.json()
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
      const query      = String(req.query.q || "").trim()
      const searchLang = String(req.query.lang || "es")

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
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" })

      // Buscar el libro por ID en Gutendex
      const searchRes = await fetch(`https://gutendex.com/books/${id}`)
      if (!searchRes.ok) return res.status(404).json({ message: "Libro no encontrado" })

      const previewLang = String(req.query.lang || "es")
      const book        = await searchRes.json()
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
  app.post("/api/admin/gutenberg/import", requireAdmin, async (req, res) => {
    try {
      const { gutenbergId, genre, overrideTitle, overrideSynopsis, lang: importLang } = req.body

      if (!gutenbergId) return res.status(400).json({ message: "Falta gutenbergId" })

      // Verificar que no existe ya
      const existing = await storage.getBooks()
      const alreadyExists = existing.some((b: any) => b.gutenbergId === gutenbergId)
      if (alreadyExists) {
        return res.status(409).json({ message: "Este libro ya está importado" })
      }

      // Descargar y procesar
      const searchRes = await fetch(`https://gutendex.com/books/${gutenbergId}`)
      if (!searchRes.ok) return res.status(404).json({ message: "Libro no encontrado en Gutenberg" })

      const gutBook  = await searchRes.json()
      const processed = await processGutenbergBook(gutBook, String(importLang || "es"))

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
      res.status(500).json({ message: err.message || "Error importando libro" })
    }
  })

  // ── ADMIN: ELIMINAR LIBRO DEL CATÁLOGO ──────────────────
  app.delete("/api/admin/books/:id", requireAdmin, async (req, res) => {
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
  app.get("/api/admin/books/all", requireAdmin, async (req, res) => {
    try {
      const all = await db.select().from(books)
      res.json(all)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── ADMIN: CAMBIAR VISIBILIDAD DE UN LIBRO ──
  // Ocultar para revisión ("review") o volver a publicar ("published")
  app.patch("/api/admin/books/:id/visibility", requireAdmin, async (req, res) => {
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
  app.get("/api/admin/admins", requireAdmin, async (req, res) => {
    try {
      const rows = await db.select().from(admins)
      res.json(rows)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── ADMIN: AGREGAR ADMINISTRADOR ─────────────────────────
  app.post("/api/admin/admins", requireAdmin, async (req, res) => {
    try {
      const { email } = req.body
      if (!email || !email.includes("@")) {
        return res.status(400).json({ message: "Email inválido" })
      }
      const addedBy = (req.user as any)?.email || "unknown"
      const existing = await db.select().from(admins).where(eq(admins.email, email))
      if (existing.length > 0) {
        return res.status(409).json({ message: "Este email ya es administrador" })
      }
      const [row] = await db.insert(admins).values({ email, addedBy }).returning()
      res.status(201).json(row)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── ADMIN: ELIMINAR ADMINISTRADOR ────────────────────────
  app.delete("/api/admin/admins/:email", requireAdmin, async (req, res) => {
    try {
      const FOUNDER = process.env.ADMIN_EMAIL || "heliossamuel17@gmail.com"
      const emailToRemove = decodeURIComponent(req.params.email)
      // El fundador no puede ser eliminado
      if (emailToRemove === FOUNDER) {
        return res.status(403).json({ message: "No puedes eliminar al administrador fundador" })
      }
      await db.delete(admins).where(eq(admins.email, emailToRemove))
      res.status(204).send()
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })


  // ── PROXY DICCIONARIO ────────────────────────────────────
  app.get("/api/dictionary/:word", async (req, res) => {
    const word     = req.params.word?.trim()
    const userLang = String(req.query.lang || "es")
    const target   = String(req.query.target || userLang)
    if (!word || word.length < 2) return res.status(400).json({ definition: null })

    function cleanDef(raw: string): string {
      return raw
        .replace(/<a[^>]*>(.*?)<\/a>/gi, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    }

    try {
      // 1. Wiktionary en español — formato real de la API
      // Respuesta: { "es": [ { "partOfSpeech":"...", "definitions":[{"definition":"..."}] } ] }
      const wikiLangs = [...new Set([userLang, "es", "en"])].slice(0, 3)
      for (const wikiLang of wikiLangs) {
        try {
          const wikiUrl = `https://${wikiLang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
          const wikiRes = await fetch(wikiUrl, {
            headers: { "User-Agent": "Tloque/1.0 dictionary-proxy" },
            signal: AbortSignal.timeout(6000),
          })
          if (!wikiRes.ok) continue
          const data = await wikiRes.json()

          // La API devuelve un objeto cuyas claves son códigos de idioma
          // Cada valor es un array de entradas por categoría gramatical
          for (const langEntries of Object.values(data) as any[][]) {
            if (!Array.isArray(langEntries)) continue
            for (const entry of langEntries) {
              const defs = entry?.definitions
              if (!Array.isArray(defs)) continue
              for (const d of defs) {
                const raw = d?.definition || d?.parsedExamples?.[0]?.definition
                if (raw && raw.length > 5) {
                  const clean = cleanDef(raw)
                  if (clean.length > 5) {
                    return res.json({ definition: clean, source: `wiktionary-${wikiLang}` })
                  }
                }
              }
            }
          }
        } catch { continue }
      }

      // 2. Free Dictionary API — inglés, muy confiable (útil para libros en inglés)
      try {
        const dictRes = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (dictRes.ok) {
          const data = await dictRes.json()
          const def = data?.[0]?.meanings?.[0]?.definitions?.[0]?.definition
          if (def) return res.json({ definition: cleanDef(def), source: "freedictionary" })
        }
      } catch {}

      // 3. Respaldo: si no hay definición, al menos TRADUCIR la palabra
      //    del idioma del libro al idioma del usuario. Así siempre hay algo útil.
      try {
        if (target && target !== userLang) {
          const tr = await translateText(word, userLang, target)
          if (tr && tr.toLowerCase() !== word.toLowerCase()) {
            return res.json({ definition: `${word} → ${tr}`, source: "translation" })
          }
        }
        // Si el libro está en otro idioma que el usuario no domina, traducir a español
        if (userLang !== "es" && target !== "es") {
          const trEs = await translateText(word, userLang, "es")
          if (trEs && trEs.toLowerCase() !== word.toLowerCase()) {
            return res.json({ definition: `${word} → ${trEs}`, source: "translation" })
          }
        }
      } catch {}

      res.json({ definition: null })
    } catch (err: any) {
      res.json({ definition: null })
    }
  })


  // ── PERFIL DE AUTOR ──────────────────────────────────────
  app.get("/api/authors/:name", async (req, res) => {
    try {
      const authorName = decodeURIComponent(req.params.name)
      // Buscar libros publicados de este autor
      const authorBooks = await db.select().from(books)
        .where(eq(books.status, "published"))

      const filtered = authorBooks.filter(b =>
        b.author?.toLowerCase() === authorName.toLowerCase()
      )

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
      const someBook = await db.select().from(books)
        .where(and(eq(books.status, "published")))
      const mine = someBook.filter(b => b.author?.toLowerCase() === nameKey)
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
  app.patch("/api/profile", async (req, res) => {
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
        const val = incoming[key]
        if (typeof val === "string" && val.trim()) {
          clean[key] = val.trim().slice(0, 300)
        }
      }

      const bio = typeof req.body?.bio === "string"
        ? req.body.bio.trim().slice(0, 500)
        : undefined

      const updates: any = { socialLinks: clean, updatedAt: new Date() }
      if (bio !== undefined) updates.bio = bio

      // Marco del avatar (id corto)
      if (typeof req.body?.frame === "string") {
        updates.frame = req.body.frame.trim().slice(0, 40)
      }

      // Foto propia (base64 o enlace). Marca customAvatar para no perderla al re-loguear.
      if (typeof req.body?.avatar === "string") {
        const av = req.body.avatar.trim().slice(0, 3_000_000)
        updates.avatar = av
        updates.customAvatar = av.length > 0   // si la quita, vuelve a tomar la de Google al loguear
      }

      // Banner (portada del perfil)
      if (typeof req.body?.banner === "string") {
        updates.banner = req.body.banner.trim().slice(0, 3_000_000)
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
  app.patch("/api/admin/authors/:name", requireAdmin, async (req, res) => {
    try {
      const name    = decodeURIComponent(req.params.name)
      const nameKey = name.toLowerCase()

      const ALLOWED = ["instagram", "x", "telegram", "youtube", "tiktok", "wikipedia", "website", "patreon", "kofi"]
      const incoming = (req.body?.socialLinks || {}) as Record<string, string>
      const clean: Record<string, string> = {}
      for (const key of ALLOWED) {
        const val = incoming[key]
        if (typeof val === "string" && val.trim()) clean[key] = val.trim().slice(0, 300)
      }

      const bio    = typeof req.body?.bio === "string"    ? req.body.bio.trim().slice(0, 500)    : ""
      // El avatar puede ser una foto en base64 (larga) o un enlace (corto).
      const avatar = typeof req.body?.avatar === "string" ? req.body.avatar.trim().slice(0, 3_000_000) : ""
      const frame  = typeof req.body?.frame === "string"  ? req.body.frame.trim().slice(0, 40)    : ""
      const banner = typeof req.body?.banner === "string" ? req.body.banner.trim().slice(0, 3_000_000) : ""

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
  app.put("/api/sync/streak", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      const days     = Math.max(0, Math.min(100000, Number(req.body?.days) || 0))
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
  app.put("/api/sync/progress", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id

      const bookId = String(req.body?.bookId || "").slice(0, 100)
      if (!bookId) return res.status(400).json({ message: "Falta bookId" })
      const chapter    = Math.max(0, Number(req.body?.chapter) || 0)
      const maxChapter = Math.max(0, Number(req.body?.maxChapter) || 0)

      const [existing] = await db.select().from(readingProgress)
        .where(and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId)))

      if (existing) {
        await db.update(readingProgress)
          .set({
            chapter,                                          // capítulo actual (puede ir atrás)
            maxChapter: Math.max(existing.maxChapter, maxChapter),  // el más lejano nunca baja
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
      // Solo restaurar los que siguen publicados
      res.json({ books: list.filter(b => b.status === "published") })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // PUT: marcar un libro como guardado (idempotente)
  app.put("/api/sync/library/:bookId", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.params.bookId)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })

      const book = await storage.getBook(bookId)
      if (!book) return res.status(404).json({ message: "Libro no encontrado" })

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
  app.delete("/api/sync/library/:bookId", async (req, res) => {
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

  async function uniqueFolio(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const f = makeFolio()
      const [dup] = await db.select().from(printCopies).where(eq(printCopies.folio, f))
      if (!dup) return f
    }
    throw new Error("No se pudo generar un folio único")
  }

  async function ensureUnlock(userId: number, bookId: number, source: string) {
    const [existing] = await db.select().from(unlockedBooks)
      .where(and(eq(unlockedBooks.userId, userId), eq(unlockedBooks.bookId, bookId)))
    if (!existing) {
      await db.insert(unlockedBooks).values({ userId, bookId, source })
    }
  }

  // Emite un token con sus ejemplares (reutilizado por el modo beta y el webhook)
  async function issueToken(userId: number, bookId: number, kind: "support" | "sale") {
    const copiesToMake = kind === "support" ? 3 : 1
    const result = await db.transaction(async (tx) => {
      const [token] = await tx.insert(bookTokens)
        .values({ kind, bookId, ownerUserId: userId }).returning()
      const copies = []
      for (let i = 0; i < copiesToMake; i++) {
        const folio = await uniqueFolio()
        const isOwnerCopy = kind === "support" && i === 0   // el 1º queda ligado al dueño
        const [copy] = await tx.insert(printCopies).values({
          tokenId:         token.id,
          folio,
          claimKey:        makeKey(),
          claimedByUserId: isOwnerCopy ? userId : null,
          claimedAt:       isOwnerCopy ? new Date() : null,
        }).returning()
        copies.push(copy)
      }
      return { token, copies }
    })
    if (kind === "support") await ensureUnlock(userId, bookId, "support")
    return result
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
  async function settleEarnings(order: { id: number; bookId: number; amountCents: number; currency: string }, shareOverride?: number) {
    const book = await storage.getBook(order.bookId)
    if (!book?.authorId || order.amountCents <= 0) return
    const share = shareOverride ?? (isStory(book) ? AUTHOR_SHARE_STORY : AUTHOR_SHARE_BOOK)
    const { authorCents, platformCents } = splitEarnings(order.amountCents, share)
    await db.insert(authorEarnings).values({
      authorUserId: book.authorId, orderId: order.id, bookId: order.bookId,
      grossCents: order.amountCents, authorCents, platformCents,
      currency: order.currency,
    })
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
        const [order] = await db.insert(tokenOrders).values({
          userId, bookId, kind, amountCents: price.cents, currency: price.currency,
          status: "pending", provider: "tinta",
        }).returning()

        // Débito ATÓMICO: un candado por usuario serializa sus gastos y el
        // INSERT solo procede si el saldo alcanza — imposible el doble gasto.
        const debit = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
          const r: any = await tx.execute(sql`
            insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
            select ${userId}, 'tinta', ${-price.tinta}, 'spend_token', 'token_order', ${order.id}
            where (select coalesce(sum(delta), 0) from wallet_ledger
                   where user_id = ${userId} and currency = 'tinta') >= ${price.tinta}
            returning id
          `)
          return (r?.rows?.length ?? 0) > 0
        })
        if (!debit) {
          await db.update(tokenOrders).set({ status: "failed" })
            .where(eq(tokenOrders.id, order.id))
          const balance = await walletBalance(userId, "tinta")
          return res.status(402).json({
            message: "tinta_insuficiente", needed: price.tinta, balance,
          })
        }

        try {
          const result = await issueToken(userId, bookId, kind as "support" | "sale")
          await db.update(tokenOrders)
            .set({ status: "paid", paidAt: new Date(), tokenId: result.token.id })
            .where(eq(tokenOrders.id, order.id))
          await settleEarnings({ ...order, amountCents: price.cents })
          return res.status(201).json({ mode: "tinta", spent: price.tinta, ...result })
        } catch (issueErr: any) {
          // Reverso: si la emisión falla, la Tinta vuelve al lector
          await db.insert(walletLedger).values({
            userId, currency: "tinta", delta: price.tinta,
            reason: "refund", refType: "token_order", refId: order.id,
          })
          await db.update(tokenOrders).set({ status: "failed" })
            .where(eq(tokenOrders.id, order.id))
          throw issueErr
        }
      }

      if (!stripeEnabled()) {
        // ── Modo beta: sin cobro ──
        const [order] = await db.insert(tokenOrders).values({
          userId, bookId, kind, amountCents: 0, currency: price.currency,
          status: "paid", provider: "beta", paidAt: new Date(),
        }).returning()
        const result = await issueToken(userId, bookId, kind as "support" | "sale")
        await db.update(tokenOrders).set({ tokenId: result.token.id })
          .where(eq(tokenOrders.id, order.id))
        return res.status(201).json({ mode: "free_beta", ...result })
      }

      // ── Modo Stripe: crear orden pendiente y sesión de pago ──
      const [order] = await db.insert(tokenOrders).values({
        userId, bookId, kind, amountCents: price.cents, currency: price.currency,
        status: "pending", provider: "stripe",
      }).returning()

      const origin = `${(req.headers["x-forwarded-proto"] as string) || req.protocol}://${req.get("host")}`
      const kindLabel = kind === "support" ? "Apoyo al autor" : "Permiso de venta"
      const session = await createCheckoutSession({
        orderId: order.id, bookTitle: book.title, kindLabel,
        cents: price.cents, currency: price.currency, origin, bookId,
      })
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
          const [order] = await db.select().from(tokenOrders).where(eq(tokenOrders.id, orderId))
          if (order && order.status === "pending") {
            const result = await issueToken(order.userId, order.bookId, order.kind as "support" | "sale")
            await db.update(tokenOrders)
              .set({ status: "paid", paidAt: new Date(), tokenId: result.token.id })
              .where(eq(tokenOrders.id, orderId))
            // Libro mayor: reparto según tipo de obra (cuento 50/50 · libro 90/10)
            await settleEarnings(order)
          }
        }
        // ── Compra de TINTA: acreditar el monedero ──
        const walletOrderId = Number(session.metadata?.walletOrderId)
        if (!isNaN(walletOrderId) && walletOrderId > 0) {
          const [wo] = await db.select().from(walletOrders).where(eq(walletOrders.id, walletOrderId))
          if (wo && wo.status === "pending") {
            await db.update(walletOrders)
              .set({ status: "paid", paidAt: new Date() })
              .where(eq(walletOrders.id, walletOrderId))
            await db.insert(walletLedger).values({
              userId: wo.userId, currency: wo.currency, delta: wo.amount,
              reason: "purchase", refType: "wallet_order", refId: wo.id,
            })
          }
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
            enabled: stripeEnabled(),
            tintaCents: TINTA_CENTS,
            prices: {
              support: priceFor("support", book),
              sale:    priceFor("sale", book),
            },
          })
        }
      }
      res.json({ enabled: stripeEnabled(), tintaCents: TINTA_CENTS, prices: PRICES })
    } catch {
      res.json({ enabled: stripeEnabled(), tintaCents: TINTA_CENTS, prices: PRICES })
    }
  })

  // ════════════════════════════════════════════════════════
  // MONEDERO — Tinta 🪙 (y Papel 📄, latente)
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

  // Paquetes de Tinta disponibles
  app.get("/api/wallet/packs", (_req, res) => {
    res.json({ enabled: stripeEnabled(), tintaCents: TINTA_CENTS, packs: TINTA_PACKS })
  })

  // Comprar un paquete (beta: se acredita gratis · Stripe: checkout)
  app.post("/api/wallet/buy", rateLimit(60_000, 6), async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const pack = TINTA_PACKS.find(p => p.id === String(req.body?.packId || ""))
      if (!pack) return res.status(400).json({ message: "Paquete inválido" })

      if (!stripeEnabled()) {
        // ── Modo beta: acreditar al instante, sin cobro ──
        const [order] = await db.insert(walletOrders).values({
          userId, currency: "tinta", amount: pack.tinta, amountCents: 0,
          status: "paid", provider: "beta", paidAt: new Date(),
        }).returning()
        await db.insert(walletLedger).values({
          userId, currency: "tinta", delta: pack.tinta,
          reason: "purchase", refType: "wallet_order", refId: order.id,
        })
        return res.status(201).json({ mode: "free_beta", credited: pack.tinta })
      }

      const [order] = await db.insert(walletOrders).values({
        userId, currency: "tinta", amount: pack.tinta, amountCents: pack.cents,
        status: "pending", provider: "stripe",
      }).returning()
      const origin = `${(req.headers["x-forwarded-proto"] as string) || req.protocol}://${req.get("host")}`
      const session = await createCheckoutSession({
        orderId: order.id, bookTitle: `${pack.tinta} Tinta`, kindLabel: "Paquete de Tinta",
        cents: pack.cents, currency: "mxn", origin, bookId: 0,
        metaKey: "walletOrderId", successPath: `/?tinta=${order.id}`, cancelPath: "/",
      })
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

  // MIS tokens (con sus ejemplares) para un libro
  app.get("/api/tokens/mine", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const bookId = Number(req.query.bookId)
      if (isNaN(bookId)) return res.status(400).json({ message: "Falta bookId" })

      const tokens = await db.select().from(bookTokens)
        .where(and(eq(bookTokens.bookId, bookId), eq(bookTokens.ownerUserId, userId)))
      const out = []
      for (const tk of tokens) {
        const copies = await db.select().from(printCopies).where(eq(printCopies.tokenId, tk.id))
        out.push({ ...tk, copies })
      }
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

      const [copy] = await db.select().from(printCopies).where(eq(printCopies.folio, folio))
      if (!copy) return res.status(404).json({ message: "Folio no encontrado" })

      if (copy.claimedByUserId && copy.claimedByUserId !== userId) {
        return res.status(409).json({ message: "taken" })   // ya reclamado por otra persona
      }
      const normalizedStored = copy.claimKey.toUpperCase().replace(/\s/g, "")
      if (key !== normalizedStored && key !== normalizedStored.replace(/-/g, "")) {
        return res.status(403).json({ message: "Clave incorrecta" })
      }

      const [token] = await db.select().from(bookTokens).where(eq(bookTokens.id, copy.tokenId))
      if (!token) return res.status(404).json({ message: "Token no encontrado" })

      if (!copy.claimedByUserId) {
        await db.update(printCopies)
          .set({ claimedByUserId: userId, claimedAt: new Date() })
          .where(eq(printCopies.id, copy.id))
      }
      await ensureUnlock(userId, token.bookId, "claim")

      res.json({ ok: true, bookId: token.bookId })
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

  // Tarjetas de una obra + cuáles posee el usuario. Si ya apoyó la
  // obra, las "support" pendientes se le otorgan aquí mismo (perezoso
  // e idempotente: cubre también tarjetas creadas DESPUÉS de su apoyo).
  app.get("/api/books/:id/cards", async (req, res) => {
    try {
      const bookId = Number(req.params.id)
      if (isNaN(bookId)) return res.status(400).json({ message: "ID inválido" })
      const cards = await db.select().from(bookCards)
        .where(eq(bookCards.bookId, bookId))
        .orderBy(bookCards.position, bookCards.id)

      let ownedIds = new Set<number>()
      if (req.isAuthenticated() && cards.length > 0) {
        const userId = (req.user as any).id
        const [unlocked] = await db.select().from(unlockedBooks)
          .where(and(eq(unlockedBooks.userId, userId), eq(unlockedBooks.bookId, bookId)))
        if (unlocked) {
          for (const c of cards.filter(c => c.unlock === "support")) {
            await db.insert(userCards).values({ userId, cardId: c.id, source: "support" })
              .onConflictDoNothing()
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
      const unlocked = await db.select().from(unlockedBooks).where(eq(unlockedBooks.userId, userId))
      const unlockedBookIds = unlocked.map(u => u.bookId)
      if (unlockedBookIds.length > 0) {
        const supportCards = await db.select().from(bookCards)
          .where(and(inArray(bookCards.bookId, unlockedBookIds), eq(bookCards.unlock, "support")))
        for (const c of supportCards) {
          await db.insert(userCards).values({ userId, cardId: c.id, source: "support" })
            .onConflictDoNothing()
        }
      }

      // Traer las tarjetas que posee, con datos de la tarjeta
      const owned = await db.select().from(userCards).where(eq(userCards.userId, userId))
      if (owned.length === 0) return res.json({ groups: [], total: 0 })
      const ownedCardIds = owned.map(o => o.cardId)
      const cards = await db.select().from(bookCards)
        .where(inArray(bookCards.id, ownedCardIds))
        .orderBy(bookCards.bookId, bookCards.position, bookCards.id)

      // Agrupar por obra (con título)
      const byBook = new Map<number, any[]>()
      for (const c of cards) {
        if (!byBook.has(c.bookId)) byBook.set(c.bookId, [])
        byBook.get(c.bookId)!.push({ ...c, owned: true })
      }
      const groups = []
      for (const [bookId, groupCards] of byBook) {
        const book = await storage.getBook(bookId)
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
      if (card.unlock !== "tinta") {
        return res.status(400).json({ message: "Esta tarjeta se obtiene apoyando la obra" })
      }
      const [already] = await db.select().from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
      if (already) return res.status(409).json({ message: "Ya está en tu colección" })

      const cost = card.priceTinta
      const [order] = await db.insert(tokenOrders).values({
        userId, bookId: card.bookId, kind: "card",
        amountCents: cost * TINTA_CENTS, currency: "mxn",
        status: "pending", provider: "tinta",
      }).returning()

      const debit = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const r: any = await tx.execute(sql`
          insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
          select ${userId}, 'tinta', ${-cost}, 'spend_card', 'token_order', ${order.id}
          where (select coalesce(sum(delta), 0) from wallet_ledger
                 where user_id = ${userId} and currency = 'tinta') >= ${cost}
          returning id
        `)
        return (r?.rows?.length ?? 0) > 0
      })
      if (!debit) {
        await db.update(tokenOrders).set({ status: "failed" }).where(eq(tokenOrders.id, order.id))
        const balance = await walletBalance(userId, "tinta")
        return res.status(402).json({ message: "tinta_insuficiente", needed: cost, balance })
      }
      try {
        await db.insert(userCards).values({ userId, cardId, source: "tinta" })
        await db.update(tokenOrders).set({ status: "paid", paidAt: new Date() })
          .where(eq(tokenOrders.id, order.id))
        // Reparto de tarjetas: 50/50 (micro-contenido; sostiene la casa)
        await settleEarnings(order, AUTHOR_SHARE_STORY)
        return res.status(201).json({ ok: true, cardId })
      } catch (issueErr: any) {
        await db.insert(walletLedger).values({
          userId, currency: "tinta", delta: cost, reason: "refund",
          refType: "token_order", refId: order.id,
        })
        await db.update(tokenOrders).set({ status: "failed" }).where(eq(tokenOrders.id, order.id))
        throw issueErr
      }
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
      if (book.authorId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo el autor puede crear tarjetas" })
      }
      const existing = await db.select().from(bookCards).where(eq(bookCards.bookId, bookId))
      if (existing.length >= MAX_CARDS_PER_BOOK) {
        return res.status(400).json({ message: `Máximo ${MAX_CARDS_PER_BOOK} tarjetas por obra` })
      }
      const v = validateCard(req.body)
      if (!v.ok) return res.status(400).json({ message: v.message })
      const [card] = await db.insert(bookCards)
        .values({ bookId, authorId: book.authorId, ...v.card, position: existing.length }).returning()
      res.status(201).json(card)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Editar tarjeta (solo el autor)
  app.put("/api/cards/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
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
      const [updated] = await db.update(bookCards).set(v.card)
        .where(eq(bookCards.id, cardId)).returning()
      res.json(updated)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Borrar tarjeta (solo el autor) — retira también las copias en colecciones
  app.delete("/api/cards/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const cardId = Number(req.params.id)
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
      const existing = await db.select().from(bookCards)
        .where(and(sql`${bookCards.bookId} IS NULL`, eq(bookCards.authorId, userId)))
      if (existing.length >= 24) {
        return res.status(400).json({ message: "Máximo 24 tarjetas sueltas" })
      }
      const v = validateCard(req.body)
      if (!v.ok) return res.status(400).json({ message: v.message })
      const [card] = await db.insert(bookCards)
        .values({ bookId: null, authorId: userId, ...v.card, position: existing.length }).returning()
      res.status(201).json(card)
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Asignar una tarjeta suelta a una obra propia
  app.post("/api/cards/:id/assign", async (req, res) => {
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
      if (book.authorId !== userId && !isAdmin(req.user)) {
        return res.status(403).json({ message: "Solo puedes asignar a tus propias obras" })
      }
      const inBook = await db.select().from(bookCards).where(eq(bookCards.bookId, bookId))
      if (inBook.length >= MAX_CARDS_PER_BOOK) {
        return res.status(400).json({ message: `Máximo ${MAX_CARDS_PER_BOOK} tarjetas por obra` })
      }
      const [updated] = await db.update(bookCards)
        .set({ bookId, position: inBook.length })
        .where(eq(bookCards.id, cardId)).returning()
      res.json(updated)
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
        .where(eq(frames.visible, true))
        .orderBy(desc(frames.createdAt))
      let ownedIds = new Set<number>()
      if (req.isAuthenticated()) {
        const userId = (req.user as any).id
        const mine = await db.select().from(userFrames).where(eq(userFrames.userId, userId))
        ownedIds = new Set(mine.map(m => m.frameId))
      }
      res.json({
        frames: list.map(f => ({ ...f, owned: ownedIds.has(f.id) || f.priceTinta <= 0 })),
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

      const [already] = await db.select().from(userFrames)
        .where(and(eq(userFrames.userId, userId), eq(userFrames.frameId, frameId)))
      if (already) return res.status(409).json({ message: "Ya tienes este marco" })

      const cost = frame.priceTinta
      if (cost <= 0) {
        await db.insert(userFrames).values({ userId, frameId, source: "gift" })
        return res.status(201).json({ ok: true, frameId, spent: 0 })
      }

      // Débito atómico: el insert solo ocurre si el saldo alcanza.
      const debit = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
        const r: any = await tx.execute(sql`
          insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
          select ${userId}, 'tinta', ${-cost}, 'spend_frame', 'frame', ${frameId}
          where (select coalesce(sum(delta), 0) from wallet_ledger
                 where user_id = ${userId} and currency = 'tinta') >= ${cost}
          returning id
        `)
        return (r?.rows?.length ?? 0) > 0
      })

      if (!debit) {
        const balance = await walletBalance(userId, "tinta")
        return res.status(402).json({
          message: "tinta_insuficiente",
          needed: cost, balance, missing: Math.max(0, cost - balance),
        })
      }

      try {
        await db.insert(userFrames).values({ userId, frameId, source: "tinta" })
        return res.status(201).json({ ok: true, frameId, spent: cost })
      } catch (issueErr: any) {
        // Si falla el desbloqueo tras cobrar, se devuelve la Tinta.
        await db.insert(walletLedger).values({
          userId, currency: "tinta", delta: cost, reason: "refund",
          refType: "frame", refId: frameId,
        })
        throw issueErr
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // Retirar un marco de la galería (solo admin). No borra: lo oculta,
  // para no romper los desbloqueos ya comprados.
  app.delete("/api/admin/frames/:id", requireAdmin, async (req, res) => {
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
  app.post("/api/gacha/exclusions", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Inicia sesión" })
      const userId = (req.user as any).id
      const raw = Array.isArray(req.body?.genres) ? req.body.genres : []
      const genres = raw.filter((g: any) => typeof g === "string").slice(0, 3)
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
  app.post("/api/admin/gacha/toggle", requireAdmin, async (req, res) => {
    try {
      const enabled = req.body?.enabled === true
      await db.update(gachaConfig).set({ enabled, updatedAt: new Date() })
        .where(eq(gachaConfig.id, 1))
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
  app.post("/api/admin/gacha/recompute-scores", requireAdmin, async (_req, res) => {
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
  app.put("/api/cards/:id/gacha", async (req, res) => {
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

      // Cuántas de esa rareza ya tiene la obra (sin contar esta misma)
      const usadas: any = await db.execute(sql`
        select count(*) as n from book_cards
        where book_id = ${card.bookId} and in_gacha_pool = true
          and rarity = ${rarity} and id <> ${cardId}
      `)
      const yaHay = Number(usadas?.rows?.[0]?.n ?? 0)

      // La escalera decide: ¿desbloqueó esa rareza? ¿le queda cupo?
      const chk = canUseRarity(
        rarity,
        Number((book as any).gachaScore ?? 0),
        book.type || "book",
        yaHay,
      )
      if (!chk.ok) return res.status(403).json({ message: chk.why })

      await db.update(bookCards)
        .set({ inGachaPool: true, rarity })
        .where(eq(bookCards.id, cardId))
      res.json({ inGachaPool: true, rarity })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  // ── BETA DE ADMIN: probar el sorteo entero sin usuarios reales ──
  // Enciende el sistema, siembra un catálogo de prueba y regala Tinta.
  // Todo lo sembrado queda marcado para poder borrarlo de un tirón.
  app.post("/api/admin/gacha/beta", requireAdmin, async (req, res) => {
    try {
      const userId = (req.user as any).id
      const action = String(req.body?.action || "setup")

      if (action === "setup") {
        // 1. Encender el sorteo
        await db.update(gachaConfig).set({ enabled: true, updatedAt: new Date() })
          .where(eq(gachaConfig.id, 1))

        // 2. Sembrar el pozo, para que las rarezas altas estén desbloqueadas
        const seedPool = Number(req.body?.pool) || 20_000
        await db.update(gachaConfig).set({ poolBalance: seedPool }).where(eq(gachaConfig.id, 1))

        // 3. Regalar Tinta al admin para poder tirar
        const tinta = Number(req.body?.tinta) || 4_000
        await db.insert(walletLedger).values({
          userId, currency: "tinta", delta: tinta,
          reason: "grant", refType: "admin_beta", refId: 0,
        })

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
        await db.update(gachaConfig)
          .set({ enabled: false, poolBalance: 0, updatedAt: new Date() })
          .where(eq(gachaConfig.id, 1))
        await db.update(bookCards).set({ inGachaPool: false })
        await db.delete(gachaDraws)
        await db.delete(gachaPity)
        return res.json({ ok: true, mode: "off", message: "Beta apagada y limpiada." })
      }

      return res.status(400).json({ message: "action debe ser setup o teardown" })
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Error" })
    }
  })

  return httpServer;
}
