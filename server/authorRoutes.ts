import type { Express, Request, Response } from "express"
import { and, eq, sql } from "drizzle-orm"
import { authorProfiles, books, users } from "@shared/schema"
import { db } from "./db"
import { storage } from "./storage"
import { entitledBookIdsFor, withoutPremiumArt } from "./bookAccess"

export function registerAuthorRoutes(app: Express) {
  const serve = async (req: Request, res: Response, authorId: number | null, name: string, card = false) => {
    const [profile] = authorId === null
      ? await db.select().from(authorProfiles).where(eq(authorProfiles.nameKey, name.toLowerCase()))
      : await db.select().from(users).where(and(eq(users.id, authorId), sql`${users.deletedAt} is null`))
    if (authorId !== null && !profile) return res.status(404).json({ message: "Autor no encontrado" })
    if (card) return res.json({ avatar: profile?.avatar || "", frame: profile?.frame || "" })
    const catalog = await storage.getBooks({ authorId, ...(authorId === null ? { author: name } : {}), limit: 100 })
    const entitled = await entitledBookIdsFor(req.isAuthenticated() ? req.user : null, catalog)
    return res.json({
      name: authorId !== null ? (profile as any).name : name,
      authorId, isClassicProfile: authorId === null,
      avatar: profile?.avatar || null, banner: profile?.banner || "", bio: profile?.bio || "",
      frame: profile?.frame || "", socialLinks: profile?.socialLinks || {},
      books: catalog.map(book => withoutPremiumArt(book, entitled.has(book.id))),
    })
  }
  const stable = (card = false) => async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Autor inválido" })
    try { return await serve(req, res, id, "", card) }
    catch { return res.status(500).json({ message: "No se pudo cargar el autor" }) }
  }
  const classic = (card = false) => async (req: Request, res: Response) => {
    try { return await serve(req, res, null, String(req.params.name), card) }
    catch { return res.status(500).json({ message: "No se pudo cargar el autor" }) }
  }
  app.get("/api/authors/id/:id", stable())
  app.get("/api/authors/id/:id/card", stable(true))
  app.get("/api/authors/classic/:name", classic())
  app.get("/api/authors/classic/:name/card", classic(true))
  const legacy = (card = false) => async (req: Request, res: Response) => {
    try {
      const name = String(req.params.name)
      const candidates = await db.selectDistinct({ authorId: books.authorId }).from(books).where(and(
        eq(books.status, "published"), eq(books.rightsHold, false),
        sql`lower(${books.author}) = lower(${name})`,
      ))
      if (candidates.length > 1) return res.status(409).json({
        message: "Hay varios autores con este nombre. Elige el perfil de la obra.",
        candidates: candidates.map(candidate => ({ ...candidate, name,
          path: candidate.authorId ? `/author/id/${candidate.authorId}` : `/author/classic/${encodeURIComponent(name)}` })),
      })
      return await serve(req, res, candidates[0]?.authorId ?? null, name, card)
    } catch { return res.status(500).json({ message: "No se pudo cargar el autor" }) }
  }
  app.get("/api/authors/:name", legacy())
  app.get("/api/authors/:name/card", legacy(true))
}
