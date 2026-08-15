import passport from "passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import expressSession from "express-session"
import { createRequire } from "module"
import { pool } from "./db"
import { db } from "./db"
import { users, admins } from "@shared/schema"
import { eq } from "drizzle-orm"
import type { Express, RequestHandler } from "express"

const require = createRequire(import.meta.url)
const ConnectPgSimple = require("connect-pg-simple")
const PgStore = ConnectPgSimple(expressSession)

// ── ADMIN — basado en tabla BD ────────────────────────────
// El email fundador siempre tiene acceso aunque la tabla esté vacía
const FOUNDER_EMAIL = process.env.ADMIN_EMAIL || "heliossamuel17@gmail.com"

// Cache en memoria — se actualiza cada 5 minutos para no pegar la BD en cada request
let adminCache: Set<string> = new Set([FOUNDER_EMAIL])
let adminCacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

async function refreshAdminCache(): Promise<void> {
  try {
    const rows = await db.select().from(admins)
    adminCache = new Set([FOUNDER_EMAIL, ...rows.map(r => r.email)])
    adminCacheTime = Date.now()
  } catch {
    // Si falla la BD, mantener el caché anterior o solo el fundador
    adminCache = new Set([FOUNDER_EMAIL])
  }
}

export async function isAdminEmail(email: string): Promise<boolean> {
  if (Date.now() - adminCacheTime > CACHE_TTL) {
    await refreshAdminCache()
  }
  return adminCache.has(email)
}

export function isAdmin(user: any): boolean {
  // Sincrónico — usa el caché en memoria
  return !!user && adminCache.has(user.email)
}

export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "No autenticado" })
  }
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: "Sin permisos de administrador" })
  }
  next()
}

// Asegurar que el fundador siempre esté en la tabla admins
export async function ensureFounderAdmin(): Promise<void> {
  try {
    const existing = await db.select().from(admins)
      .where(eq(admins.email, FOUNDER_EMAIL))
    if (existing.length === 0) {
      await db.insert(admins).values({
        email:   FOUNDER_EMAIL,
        addedBy: "system",
      })
    }
    await refreshAdminCache()
  } catch (err) {
    console.warn("Could not ensure founder admin:", err)
  }
}

// ── SERIALIZACIÓN ─────────────────────────────────────────
passport.serializeUser((user: any, done) => {
  done(null, user.id)
})

passport.deserializeUser(async (id: number, done) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id))
    done(null, user || null)
  } catch (err) {
    done(err, null)
  }
})

// ── ESTRATEGIA GOOGLE ─────────────────────────────────────
const BASE_URL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : process.env.APP_URL || "https://novareads.heliossamuel17.repl.co"

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL:  `${BASE_URL}/api/auth/google/callback`,
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const [existing] = await db
        .select().from(users)
        .where(eq(users.googleId, profile.id))

      if (existing) {
        // No sobreescribir el avatar si el usuario subió una foto propia.
        const keepAvatar = (existing as any).customAvatar === true
        const [updated] = await db.update(users)
          .set({
            name:   profile.displayName,
            avatar: keepAvatar ? existing.avatar : (profile.photos?.[0]?.value || ""),
            updatedAt: new Date(),
          })
          .where(eq(users.googleId, profile.id))
          .returning()
        return done(null, updated)
      }

      const [newUser] = await db.insert(users).values({
        googleId: profile.id,
        email:    profile.emails?.[0]?.value || "",
        name:     profile.displayName,
        avatar:   profile.photos?.[0]?.value || "",
      }).returning()

      return done(null, newUser)
    } catch (err) {
      return done(err as Error)
    }
  }
))

// ── SESSION ───────────────────────────────────────────────
export const sessionMiddleware: RequestHandler = expressSession({
  store: new PgStore({
    pool,
    tableName:            "user_sessions",
    createTableIfMissing: true,
  }),
  secret:            process.env.SESSION_SECRET || "novareads-dev-secret",
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   30 * 24 * 60 * 60 * 1000,
    secure:   process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
})

export function setupAuth(app: Express) {
  app.use(sessionMiddleware)
  app.use(passport.initialize())
  app.use(passport.session())
}

export function setupAuthRoutes(app: Express) {
  app.get("/api/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
  )
  app.get("/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth=error" }),
    (_req, res) => { res.redirect("/") }
  )
  app.get("/api/auth/logout", (req, res) => {
    req.logout(() => { res.redirect("/") })
  })
  app.get("/api/auth/me", async (req, res) => {
    if (!req.isAuthenticated()) return res.json(null)
    const user = req.user as any
    // Incluir isAdmin en la respuesta para que el cliente no necesite hardcodear emails
    const adminStatus = isAdmin(user)
    res.json({ ...user, isAdmin: adminStatus })
  })
}
