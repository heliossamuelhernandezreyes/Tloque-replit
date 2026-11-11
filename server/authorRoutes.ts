import type { Express, Request, Response } from "express"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { authorProfiles, books, users } from "@shared/schema"
import { authorPath, isValidAuthorName } from "@shared/author-path"
import { db } from "./db"
import { storage } from "./storage"
import { entitledBookIdsFor, withoutPremiumArt } from "./bookAccess"

const catalogInput = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(120).optional(),
})
type AuthorView = "profile" | "card" | "books"

function activeAuthor(id: number) {
  return and(eq(users.id, id), isNull(users.deletedAt))
}

export function registerAuthorRoutes(app: Express) {
  const serve = async (req: Request, res: Response, authorId: number | null, name: string, view: AuthorView) => {
    res.setHeader("Cache-Control", "private, no-store")
    const parsed = catalogInput.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: "Filtros del autor inválidos" })
    const catalogPage = async () => {
      const limit = parsed.data.limit ?? (view === "profile" ? 100 : 24)
      const rows = await storage.getBooks({
        authorId, author: authorId === null ? name : undefined, title: parsed.data.q,
        before: parsed.data.before, limit: Math.min(100, limit + 1),
      })
      const catalog = rows.slice(0, limit)
      const entitled = await entitledBookIdsFor(req.isAuthenticated() ? req.user : null, catalog)
      return {
        books: catalog.map(book => withoutPremiumArt(book, entitled.has(book.id))),
        nextCursor: rows.length > limit || limit === 100 && rows.length === 100 ? catalog.at(-1)!.id : null,
      }
    }

    if (view === "books") {
      if (authorId !== null) {
        const [account] = await db.select({ id: users.id }).from(users).where(activeAuthor(authorId))
        if (!account) return res.status(404).json({ message: "Autor no encontrado" })
      }
      return res.json(await catalogPage())
    }

    const [profile] = authorId === null
      ? await db.select({
        name: authorProfiles.displayName, avatar: authorProfiles.avatar, banner: authorProfiles.banner,
        bio: authorProfiles.bio, frame: authorProfiles.frame, socialLinks: authorProfiles.socialLinks,
      }).from(authorProfiles).where(eq(authorProfiles.nameKey, name.toLowerCase()))
      : await db.select({
        name: users.name, avatar: users.avatar, banner: users.banner,
        bio: users.bio, frame: users.frame, socialLinks: users.socialLinks,
      }).from(users).where(activeAuthor(authorId))
    if (authorId !== null && !profile) return res.status(404).json({ message: "Autor no encontrado" })
    if (view === "card") return res.json({ avatar: profile?.avatar || "", frame: profile?.frame || "" })
    const page = await catalogPage()
    if (!profile && page.books.length === 0) return res.status(404).json({ message: "Autor no encontrado" })
    const classicName = authorId === null ? page.books[0]?.author || name : undefined
    return res.json({
      name: profile?.name || classicName,
      authorId, isClassicProfile: authorId === null, classicName,
      avatar: profile?.avatar || null, banner: profile?.banner || "", bio: profile?.bio || "",
      frame: profile?.frame || "", socialLinks: profile?.socialLinks || {},
      ...page,
    })
  }
  const stable = (view: AuthorView) => async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Autor inválido" })
    try { return await serve(req, res, id, "", view) }
    catch { return res.status(500).json({ message: "No se pudo cargar el autor" }) }
  }
  const classic = (view: AuthorView) => async (req: Request, res: Response) => {
    const name = String(req.params.name)
    if (!isValidAuthorName(name)) return res.status(400).json({ message: "Autor inválido" })
    try { return await serve(req, res, null, name, view) }
    catch { return res.status(500).json({ message: "No se pudo cargar el autor" }) }
  }
  app.get("/api/authors/id/:id", stable("profile"))
  app.get("/api/authors/id/:id/card", stable("card"))
  app.get("/api/authors/id/:id/books", stable("books"))
  app.get("/api/authors/classic/:name", classic("profile"))
  app.get("/api/authors/classic/:name/card", classic("card"))
  app.get("/api/authors/classic/:name/books", classic("books"))
  const legacy = (view: AuthorView) => async (req: Request, res: Response) => {
    try {
      const name = String(req.params.name)
      if (!isValidAuthorName(name)) return res.status(400).json({ message: "Autor inválido" })
      const candidates = await db.selectDistinctOn([books.authorId], {
        authorId: books.authorId, name: books.author, exampleTitle: books.title,
      }).from(books).where(and(
        eq(books.status, "published"), eq(books.rightsHold, false),
        sql`lower(${books.author}) = lower(${name})`,
      )).orderBy(books.authorId, desc(books.id))
      res.setHeader("Cache-Control", "private, no-store")
      if (candidates.length > 1) return res.status(409).json({
        name,
        message: "Hay varios autores con este nombre. Elige el perfil de la obra.",
        candidates: candidates.map(candidate => ({ ...candidate,
          path: authorPath({ authorId: candidate.authorId, author: candidate.name }) })),
      })
      return await serve(req, res, candidates[0]?.authorId ?? null, name, view)
    } catch { return res.status(500).json({ message: "No se pudo cargar el autor" }) }
  }
  app.get("/api/authors/:name", legacy("profile"))
  app.get("/api/authors/:name/card", legacy("card"))
}
