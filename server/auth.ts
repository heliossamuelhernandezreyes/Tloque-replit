import passport from "passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import expressSession from "express-session"
import connectPgSimple from "connect-pg-simple"
import { pool } from "./db"
import { db } from "./db"
import { users, admins, books } from "@shared/schema"
import { eq } from "drizzle-orm"
import type { Express, RequestHandler } from "express"
import { configuredPublicOrigin } from "./security"

const PgStore = connectPgSimple(expressSession)

// ── ADMIN — basado en tabla BD ────────────────────────────
// El email fundador siempre tiene acceso aunque la tabla esté vacía. En
// producción debe ser explícito: un administrador codificado en el repositorio
// convertiría una filtración del código en información útil para un atacante.
const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || ""
if (process.env.NODE_ENV === "production"
    && (!configuredAdminEmail || configuredAdminEmail === "admin@example.com")) {
  throw new Error("ADMIN_EMAIL must be configured with the founder email in production")
}
export const FOUNDER_EMAIL = configuredAdminEmail
const SESSION_COOKIE_NAME = "tloque.sid"

// Cache en memoria — se actualiza cada 5 minutos para no pegar la BD en cada request
let adminCache: Set<string> = new Set(FOUNDER_EMAIL ? [FOUNDER_EMAIL] : [])
let adminCacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

export async function refreshAdminCache(): Promise<void> {
  try {
    const rows = await db.select().from(admins)
    adminCache = new Set([
      ...(FOUNDER_EMAIL ? [FOUNDER_EMAIL] : []),
      ...rows.map(r => r.email.trim().toLowerCase()),
    ])
    adminCacheTime = Date.now()
  } catch {
    // Mantener el último valor conocido. Vaciarlo aquí hacía que réplicas
    // distintas retiraran temporalmente permisos a admins delegados.
  }
}

export async function isAdminEmail(email: string): Promise<boolean> {
  if (Date.now() - adminCacheTime > CACHE_TTL) {
    await refreshAdminCache()
  }
  return adminCache.has(email.trim().toLowerCase())
}

export function isAdmin(user: any): boolean {
  // Sincrónico — usa el caché en memoria
  return !!user && typeof user.email === "string" && adminCache.has(user.email.trim().toLowerCase())
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
    // En desarrollo sin ADMIN_EMAIL no insertar una identidad ficticia en la
    // base. Los administradores ya registrados siguen cargándose normalmente.
    if (!configuredAdminEmail) {
      await refreshAdminCache()
      console.warn("ADMIN_EMAIL is not configured; no founder account was inserted")
      return
    }
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
    if (process.env.NODE_ENV === "production") throw err
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
    done(null, user && !user.deletedAt ? user : null)
  } catch (err) {
    done(err, null)
  }
})

// ── ESTRATEGIA GOOGLE ─────────────────────────────────────
const configuredBaseUrl = configuredPublicOrigin()
if (process.env.NODE_ENV === "production" && !configuredBaseUrl) {
  throw new Error("APP_URL must be configured in production")
}
if (process.env.NODE_ENV === "production"
    && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
  throw new Error("Google OAuth credentials must be configured in production")
}
const BASE_URL = configuredBaseUrl || "http://localhost:5000"

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID || "missing-google-client-id",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "missing-google-client-secret",
    callbackURL:  `${BASE_URL}/api/auth/google/callback`,
    state:        true,
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const googleEmail = profile.emails
        ?.find(candidate => candidate.verified !== false)
        ?.value.trim().toLowerCase()
      if (!googleEmail || googleEmail.length > 254) {
        return done(new Error("Google must provide a verified email address"))
      }
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
        email:    googleEmail,
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
const sessionSecret = process.env.SESSION_SECRET
if (process.env.NODE_ENV === "production" && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error("SESSION_SECRET must contain at least 32 characters in production")
}

export const sessionMiddleware: RequestHandler = expressSession({
  name: SESSION_COOKIE_NAME,
  store: new PgStore({
    pool,
    tableName:            "user_sessions",
    createTableIfMissing: true,
  }),
  secret:            sessionSecret || "tloque-development-only-session-secret",
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  proxy:             process.env.NODE_ENV === "production",
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
  app.post("/api/auth/logout", (req, res, next) => {
    req.logout((error) => {
      if (error) return next(error)
      req.session.destroy((destroyError) => {
        if (destroyError) return next(destroyError)
        res.clearCookie(SESSION_COOKIE_NAME)
        res.status(204).send()
      })
    })
  })
  app.get("/api/auth/me", async (req, res) => {
    if (!req.isAuthenticated()) return res.json(null)
    const user = req.user as any
    // Incluir isAdmin en la respuesta para que el cliente no necesite hardcodear emails
    const adminStatus = isAdmin(user)
    const [authored] = await db.select({ id: books.id }).from(books)
      .where(eq(books.authorId, user.id)).limit(1)
    const hasAuthoredWorks = !!authored
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar || "",
      banner: user.banner || "",
      bio: user.bio || "",
      frame: user.frame || "",
      socialLinks: user.socialLinks || {},
      isAdmin: adminStatus,
      persona: adminStatus ? "admin" : hasAuthoredWorks ? "author" : "reader",
      roles: {
        reader: true,
        author: hasAuthoredWorks,
        admin: adminStatus,
      },
      capabilities: {
        createBooks: true,
        manageOwnBooks: true,
        manageEditions: true,
        manageCatalog: adminStatus,
        manageAudioCatalog: adminStatus,
        manageFrames: adminStatus,
        manageAdmins: adminStatus,
        runDiagnostics: adminStatus,
      },
      subscription: {
        plan: user.subscriptionPlan || "reader",
        status: user.subscriptionStatus || "inactive",
        expiresAt: user.subscriptionExpiresAt || null,
      },
    })
  })
}
