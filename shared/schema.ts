import { pgTable, text, serial, boolean, timestamp, jsonb, integer, unique, real } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"
import { isSafeHttpsUrl, isSafeImageSource } from "./media"
import type { ExperienceProfileV1, NarrativeProjectV1 } from "./narrative"
import type { SpeechProfileV1, SpeechProjectV1 } from "./speech"
import type { AdvancedDirectionProjectV2 } from "./direction"

// ── USUARIOS ─────────────────────────────────────────────
export const users = pgTable("users", {
  id:        serial("id").primaryKey(),
  googleId:  text("google_id").notNull().unique(),
  email:     text("email").notNull().unique(),
  name:      text("name").notNull(),
  avatar:    text("avatar").default(""),
  // Perfil de autor (florece al publicar): biografía y enlaces sociales.
  bio:         text("bio").default(""),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().default({}),
  // Marco del avatar (elegido o desbloqueado) y si subió una foto propia.
  frame:        text("frame").default(""),
  customAvatar: boolean("custom_avatar").default(false).notNull(),
  banner:    text("banner").default(""),            // portada del perfil
  subscriptionPlan: text("subscription_plan").notNull().default("reader"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type User       = typeof users.$inferSelect
export type InsertUser = typeof users.$inferInsert

// ── ADMINISTRADORES ───────────────────────────────────────
// Tabla para gestionar quién tiene permisos de admin.
// El ADMIN_EMAIL configurado se auto-inserta al arrancar.
export const admins = pgTable("admins", {
  id:        serial("id").primaryKey(),
  email:     text("email").notNull().unique(),
  addedBy:   text("added_by").notNull().default("system"),   // email de quien lo agregó
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export type Admin       = typeof admins.$inferSelect
export type InsertAdmin = typeof admins.$inferInsert

// ── CAPÍTULOS ─────────────────────────────────────────────
export const chapterSchema = z.object({
  title:   z.string().trim().max(200),
  content: z.string().max(2_000_000),
})
export type Chapter = z.infer<typeof chapterSchema>


export const coverFxLayerSchema = z.object({
  back:  z.string().refine(isSafeImageSource, "Imagen no permitida").optional().default(""),
  mid:   z.string().refine(isSafeImageSource, "Imagen no permitida").optional().default(""),
  front: z.string().refine(isSafeImageSource, "Imagen no permitida").optional().default(""),
})

export const coverFxSchema = z.object({
  mode:   z.enum(["simple", "layered"]).default("simple"),
  layers: coverFxLayerSchema.default({ back: "", mid: "", front: "" }),
})

export type CoverFx = z.infer<typeof coverFxSchema>

// ── LIBROS ────────────────────────────────────────────────
export const books = pgTable("books", {
  id:              serial("id").primaryKey(),
  title:           text("title").notNull(),
  author:          text("author").notNull(),
  authorId:        integer("author_id").references(() => users.id),
  coverUrl:        text("cover_url").notNull().default(""),
  coverFx:         jsonb("cover_fx").$type<CoverFx>().default({ mode: "simple", layers: { back: "", mid: "", front: "" } }),
  content:         text("content").notNull().default(""),
  synopsis:        text("synopsis").notNull().default(""),
  genre:           text("genre").notNull().default(""),        // melancolico, terror, etc. vacío = sin género específico
  chapters:        jsonb("chapters").notNull().default([]),
  type:            text("type").notNull().default("book"),     // "book" | "story" | "saga"
  status:          text("status").notNull().default("draft"),  // "draft" | "published"

  // ── Clásicos ──────────────────────────────────────────
  // ── El score que GANA la rareza (se recalcula, no se elige) ──
  gachaScore:      real("gacha_score").default(0).notNull(),
  rarityCeiling:   text("rarity_ceiling").default("common").notNull(),

  isClassic:       boolean("is_classic").default(false).notNull(),
  bannerUrl:       text("banner_url").default(""),   // banner editorial (clásicos: lo pone admin)
  publicationYear: integer("publication_year"),               // año de publicación original
  originalLanguage: text("original_language").default(""),    // "es", "en", "ru", etc.

  gutenbergId:     integer("gutenberg_id"),                      // ID en Project Gutenberg — evita duplicados
  spotifyLink:     text("spotify_link").default(""),
  backCoverUrl:    text("back_cover_url").default(""),    // contraportada — para tokens de impresión física
  // Vestido PREMIUM de la obra: se muestra a quienes la apoyaron (token)
  premiumCoverUrl: text("premium_cover_url").default(""),
  premiumBackUrl:  text("premium_back_url").default(""),
  isSaved:         boolean("is_saved").default(false).notNull(),
  isAuthored:      boolean("is_authored").default(false).notNull(),
  // Interruptor maestro del autor: encender/apagar comentarios en su obra.
  commentsEnabled: boolean("comments_enabled").default(true).notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
})

export const insertBookSchema = createInsertSchema(books, {
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  synopsis: z.string().max(8_000).default(""),
  content: z.string().max(2_000_000).default(""),
  genre: z.string().trim().max(60).default(""),
  type: z.enum(["book", "story", "saga"]).default("book"),
  status: z.enum(["draft", "published", "review"]).default("draft"),
  chapters: z.array(chapterSchema).max(500).default([]),
  coverUrl: z.string().refine(isSafeImageSource, "Portada no permitida").default(""),
  backCoverUrl: z.string().refine(isSafeImageSource, "Contraportada no permitida").default(""),
  premiumCoverUrl: z.string().refine(isSafeImageSource, "Portada premium no permitida").default(""),
  premiumBackUrl: z.string().refine(isSafeImageSource, "Contraportada premium no permitida").default(""),
  bannerUrl: z.string().refine(isSafeImageSource, "Banner no permitido").default(""),
  spotifyLink: z.string().max(2_000).refine(v => v === "" || isSafeHttpsUrl(v), "Enlace de Spotify no permitido").default(""),
  originalLanguage: z.string().trim().max(12)
    .refine(v => v === "" || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(v), "Idioma original inválido")
    .default(""),
  publicationYear: z.number().int().min(-4_000).max(new Date().getUTCFullYear() + 1).nullable().optional(),
  coverFx: coverFxSchema.optional().default({ mode: "simple", layers: { back: "", mid: "", front: "" } }),
}).omit({ id: true, createdAt: true, updatedAt: true })

export type Book              = typeof books.$inferSelect
export type InsertBook        = z.input<typeof insertBookSchema>
export type CreateBookRequest = typeof books.$inferInsert
export type UpdateBookRequest = Partial<CreateBookRequest>

// ── COMENTARIOS ────────────────────────────────────────────
// Comentarios por libro y por capítulo. chapterIndex = -1 son
// comentarios "generales" (al terminar el libro). status oculta
// sin borrar (moderación de autor/admin).
export const comments = pgTable("comments", {
  id:           serial("id").primaryKey(),
  bookId:       integer("book_id").references(() => books.id).notNull(),
  chapterIndex: integer("chapter_index").notNull().default(0),  // -1 = general
  userId:       integer("user_id").references(() => users.id).notNull(),
  userName:     text("user_name").notNull().default(""),        // denormalizado para mostrar
  userAvatar:   text("user_avatar").default(""),                // denormalizado
  content:      text("content").notNull(),
  status:       text("status").notNull().default("visible"),    // "visible" | "hidden"
  createdAt:    timestamp("created_at").defaultNow().notNull(),
})

export const insertCommentSchema = createInsertSchema(comments, {
  content: z.string().trim().min(1, "El comentario no puede estar vacío").max(2000),
}).omit({ id: true, createdAt: true, status: true, userName: true, userAvatar: true, userId: true })

export type Comment       = typeof comments.$inferSelect
export type InsertComment = z.infer<typeof insertCommentSchema>

// ── PERFILES DE AUTORES SIN CUENTA (CLÁSICOS) ──────────────
// Los autores clásicos (Poe, Dostoyevski) no tienen cuenta de usuario.
// Su perfil (bio, enlaces, avatar) se guarda aquí, ligado al nombre.
// Los administradores los editan para darles una presencia digna.
export const authorProfiles = pgTable("author_profiles", {
  id:          serial("id").primaryKey(),
  nameKey:     text("name_key").notNull().unique(),   // nombre en minúsculas, clave única
  displayName: text("display_name").notNull().default(""),
  bio:         text("bio").default(""),
  avatar:      text("avatar").default(""),
  banner:      text("banner").default(""),          // imagen de portada del perfil
  frame:       text("frame").default(""),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().default({}),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
})

export type AuthorProfile = typeof authorProfiles.$inferSelect

// ── SINCRONIZACIÓN: racha y progreso (respaldo en la nube) ──
// La racha es un valor por usuario. El progreso es uno por usuario+libro.
// Lo local sigue mandando para velocidad; esto es la red de seguridad.
export const userState = pgTable("user_state", {
  userId:         integer("user_id").primaryKey().references(() => users.id),
  streakDays:     integer("streak_days").default(0).notNull(),
  streakLastDate: text("streak_last_date").default(""),   // valor de toDateString()
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
})

export const readingProgress = pgTable("reading_progress", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").references(() => users.id).notNull(),
  bookId:     text("book_id").notNull(),                  // id del libro (texto, flexible)
  chapter:    integer("chapter").default(0).notNull(),    // capítulo actual
  maxChapter: integer("max_chapter").default(0).notNull(),// capítulo más lejano alcanzado
  updatedAt:  timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqUserBook: unique("uniq_user_book").on(t.userId, t.bookId),
}))

export type UserState       = typeof userState.$inferSelect
export type ReadingProgress = typeof readingProgress.$inferSelect

// Biblioteca guardada en la nube: qué libros del catálogo guardó cada usuario.
// Solo referencias (el contenido vive en books). Los borradores locales no van aquí.
export const savedBooks = pgTable("saved_books", {
  id:      serial("id").primaryKey(),
  userId:  integer("user_id").references(() => users.id).notNull(),
  bookId:  integer("book_id").references(() => books.id).notNull(),
  savedAt: timestamp("saved_at").defaultNow().notNull(),
}, (t) => ({
  uniqUserSaved: unique("uniq_user_saved").on(t.userId, t.bookId),
}))

export type SavedBook = typeof savedBooks.$inferSelect

// ── SISTEMA DE TOKENS (fase 1: plomería, sin pagos) ─────────
// Un token de APOYO da acceso permanente + 3 ejemplares imprimibles.
// Un token de VENTA da 1 ejemplar imprimible con permiso de venta.
// Cada EJEMPLAR tiene folio único (va en el QR de la portada) y una
// clave (va impresa DENTRO del libro): folio+clave = reclamo único.
export const bookTokens = pgTable("book_tokens", {
  id:          serial("id").primaryKey(),
  kind:        text("kind").notNull(),                                // "support" | "sale"
  bookId:      integer("book_id").references(() => books.id).notNull(),
  ownerUserId: integer("owner_user_id").references(() => users.id).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
})

export const printCopies = pgTable("print_copies", {
  id:              serial("id").primaryKey(),
  tokenId:         integer("token_id").references(() => bookTokens.id).notNull(),
  folio:           text("folio").notNull().unique(),                  // TLQ-XXXX-XXXX
  claimKey:        text("claim_key").notNull(),                       // clave impresa dentro
  claimedByUserId: integer("claimed_by_user_id").references(() => users.id),
  claimedAt:       timestamp("claimed_at"),
  // Ciclo comercial del ejemplar. Nunca se infiere una venta a partir del
  // reclamo digital: son hechos distintos y pueden ocurrir en otro orden.
  saleStatus:      text("sale_status").notNull().default("available"), // available | sold | returned
  soldAt:          timestamp("sold_at"),
  salePriceCents:  integer("sale_price_cents"),
  saleChannel:     text("sale_channel").notNull().default(""),
  saleNote:        text("sale_note").notNull().default(""),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
})

// Bitácora inmutable de cambios comerciales. Permite corregir el estado de un
// ejemplar sin perder quién lo marcó como vendido o devuelto.
export const printCopyEvents = pgTable("print_copy_events", {
  id:          serial("id").primaryKey(),
  copyId:      integer("copy_id").references(() => printCopies.id).notNull(),
  actorUserId: integer("actor_user_id").references(() => users.id).notNull(),
  eventType:   text("event_type").notNull(), // marked_sold | marked_available | marked_returned
  metadata:    jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
})

// Buzón transaccional. Las rutas de destino se validan en servidor; no se
// aceptan HTML ni URLs arbitrarias desde el cliente.
export const notifications = pgTable("notifications", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").references(() => users.id).notNull(),
  kind:        text("kind").notNull().default("system"),
  title:       text("title").notNull(),
  body:        text("body").notNull().default(""),
  destination: text("destination").notNull().default(""),
  dedupeKey:   text("dedupe_key").notNull().default(""),
  readAt:      timestamp("read_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
})

export const unlockedBooks = pgTable("unlocked_books", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").references(() => users.id).notNull(),
  bookId:    integer("book_id").references(() => books.id).notNull(),
  source:    text("source").notNull().default("support"),            // "support" | "claim"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqUserUnlocked: unique("uniq_user_unlocked").on(t.userId, t.bookId),
}))

export type BookToken     = typeof bookTokens.$inferSelect
export type PrintCopy     = typeof printCopies.$inferSelect
export type PrintCopyEvent = typeof printCopyEvents.$inferSelect
export type Notification  = typeof notifications.$inferSelect
export type UnlockedBook  = typeof unlockedBooks.$inferSelect

// ── FASE 2: ÓRDENES DE PAGO Y LIBRO MAYOR ───────────────────
// Cada adquisición pasa por una ORDEN. En modo beta se marca "paid"
// al instante sin cobrar; con Stripe activo, el webhook la confirma.
// Al pagarse, se emite el token y se asienta la ganancia del autor.
export const tokenOrders = pgTable("token_orders", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").references(() => users.id).notNull(),
  bookId:      integer("book_id").references(() => books.id).notNull(),
  kind:        text("kind").notNull(),                     // "support" | "sale"
  amountCents: integer("amount_cents").default(0).notNull(),
  currency:    text("currency").default("mxn").notNull(),
  status:      text("status").default("pending").notNull(),// pending | paid | canceled
  provider:    text("provider").default("beta").notNull(), // beta | stripe
  providerRef: text("provider_ref").default(""),           // id de sesión de Stripe
  tokenId:     integer("token_id"),                        // token emitido al pagar
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  paidAt:      timestamp("paid_at"),
})

export const authorEarnings = pgTable("author_earnings", {
  id:            serial("id").primaryKey(),
  authorUserId:  integer("author_user_id").references(() => users.id).notNull(),
  orderId:       integer("order_id").references(() => tokenOrders.id).notNull().unique(),
  bookId:        integer("book_id").references(() => books.id).notNull(),
  grossCents:    integer("gross_cents").default(0).notNull(),
  authorCents:   integer("author_cents").default(0).notNull(),   // 90%
  platformCents: integer("platform_cents").default(0).notNull(), // 10%
  currency:      text("currency").default("mxn").notNull(),
  status:        text("status").default("accrued").notNull(),    // accrued | paid_out
  createdAt:     timestamp("created_at").defaultNow().notNull(),
})

export type TokenOrder    = typeof tokenOrders.$inferSelect
export type AuthorEarning = typeof authorEarnings.$inferSelect

// ── MONEDERO (Tinta 🪙 y Papel 📄) ──────────────────────────
// wallet_ledger es un libro contable INMUTABLE (solo se insertan
// movimientos, nunca se editan): el saldo = SUMA de los deltas.
// currency: "tinta" (valor de apoyo) | "papel" (cuota medible de IA).
export const walletLedger = pgTable("wallet_ledger", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").references(() => users.id).notNull(),
  currency:  text("currency").notNull(),                    // "tinta" | "papel"
  delta:     integer("delta").notNull(),                    // + entra · − sale
  reason:    text("reason").notNull(),                      // purchase|spend_token|grant|refund
  refType:   text("ref_type").default(""),                  // wallet_order|token_order|admin
  refId:     integer("ref_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// Compras de moneda (paquetes de Tinta vía Stripe o beta)
export const walletOrders = pgTable("wallet_orders", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").references(() => users.id).notNull(),
  currency:    text("currency").notNull().default("tinta"),
  amount:      integer("amount").notNull(),                 // unidades de moneda
  amountCents: integer("amount_cents").notNull(),           // precio en centavos MXN
  status:      text("status").notNull().default("pending"), // pending|paid|failed
  provider:    text("provider").notNull().default("beta"),  // "stripe" | "beta"
  providerRef: text("provider_ref").default(""),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  paidAt:      timestamp("paid_at"),
})

export type WalletEntry = typeof walletLedger.$inferSelect
export type WalletOrder = typeof walletOrders.$inferSelect

// Medición auditable de IA. El proveedor reporta tokens o caracteres reales;
// la regla central de Papel los convierte a unidades enteras. requestKey hace
// idempotente un reintento y evita cobrar dos veces la misma generación.
export const paperUsageEvents = pgTable("paper_usage_events", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  requestKey:    text("request_key").notNull().unique(),
  feature:       text("feature").notNull(),       // oracle | elevenlabs
  provider:      text("provider").notNull().default(""),
  inputUnits:    integer("input_units").notNull().default(0),
  outputUnits:   integer("output_units").notNull().default(0),
  paperCharged:  integer("paper_charged").notNull().default(0),
  metadata:      jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
})

export type PaperUsageEvent = typeof paperUsageEvents.$inferSelect

// ── TARJETAS COLECCIONABLES (sin azar: ley de diseño) ───────
// El autor crea hasta 6 tarjetas por obra (personajes, escenas).
// Se obtienen APOYANDO la obra (unlock "support") o comprándolas
// con Tinta a precio visible (unlock "tinta"). El arte reusa el
// motor parallax de capas (CoverFxConfig: back/mid/front).
export const bookCards = pgTable("book_cards", {
  id:          serial("id").primaryKey(),
  // bookId nulo = tarjeta SUELTA (creada antes de tener libro); authorId es su dueño.
  bookId:      integer("book_id").references(() => books.id),
  authorId:    integer("author_id").references(() => users.id),
  // Rareza del SORTEO (la gana el autor con retención/apoyo/seguidores).
  // No se elige: se merece. Ver shared/gacha.ts
  rarity:      text("rarity").default("common").notNull(),
  inGachaPool: boolean("in_gacha_pool").default(false).notNull(),
  name:        text("name").notNull(),
  subtitle:    text("subtitle").notNull().default(""),
  description: text("description").notNull().default(""),
  fx:          jsonb("fx").default({}),                        // {mode, layers:{back,mid,front}}
  unlock:      text("unlock_mode").notNull().default("support"), // "support" | "tinta"
  priceTinta:  integer("price_tinta").notNull().default(0),
  position:    integer("position").notNull().default(0),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
})

export const userCards = pgTable("user_cards", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").references(() => users.id).notNull(),
  cardId:    integer("card_id").references(() => bookCards.id, { onDelete: "cascade" }).notNull(),
  source:    text("source").notNull().default("support"),     // "support" | "tinta"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqUserCard: unique("uniq_user_card").on(t.userId, t.cardId),
}))

export type BookCard = typeof bookCards.$inferSelect
export type UserCard = typeof userCards.$inferSelect

// ── FONOTECA OFICIAL ─────────────────────────────────────
// Los administradores publican activos con procedencia y licencia. Los
// autores únicamente asignan activos publicados por ID a sus capítulos.
export const audioAssets = pgTable("audio_assets", {
  id:              serial("id").primaryKey(),
  title:           text("title").notNull(),
  artist:          text("artist").notNull().default(""),
  kind:            text("kind").notNull().default("music"),
  sourceType:      text("source_type").notNull().default("stream"),
  url:             text("url").notNull(),
  recipe:          jsonb("recipe").$type<Record<string, unknown> | null>(),
  musicalKey:      text("musical_key").notNull().default(""),
  musicalMode:     text("musical_mode").notNull().default(""),
  brightness:      real("brightness").notNull().default(0.5),
  texture:         text("texture").notNull().default(""),
  tags:            jsonb("tags").$type<string[]>().notNull().default([]),
  packUrl:         text("pack_url").notNull().default(""),
  packBytes:       integer("pack_bytes"),
  packSha256:      text("pack_sha256").notNull().default(""),
  instrumentProgram: integer("instrument_program"),
  emotion:         text("emotion").notNull().default("neutral"),
  bpm:             integer("bpm"),
  energy:          real("energy").notNull().default(0.5),
  durationSeconds: integer("duration_seconds"),
  loop:            boolean("loop").notNull().default(true),
  license:         text("license").notNull(),
  sourceName:      text("source_name").notNull().default(""),
  sourceUrl:       text("source_url").notNull().default(""),
  status:          text("status").notNull().default("draft"),
  createdBy:       integer("created_by").references(() => users.id),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
})

export const chapterAudioAssignments = pgTable("chapter_audio_assignments", {
  id:               serial("id").primaryKey(),
  bookId:           integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex:     integer("chapter_index").notNull(),
  assetId:          integer("asset_id").references(() => audioAssets.id).notNull(),
  volume:           real("volume").notNull().default(0.35),
  loop:             boolean("loop").notNull().default(true),
  crossfadeSeconds: real("crossfade_seconds").notNull().default(6),
  assignedBy:       integer("assigned_by").references(() => users.id),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqBookChapterAudio: unique("uniq_book_chapter_audio").on(t.bookId, t.chapterIndex),
}))

export const audioFavorites = pgTable("audio_favorites", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  assetId:   integer("asset_id").references(() => audioAssets.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqAudioFavorite: unique("uniq_audio_favorite").on(t.userId, t.assetId),
}))

export type AudioAsset = typeof audioAssets.$inferSelect
export type ChapterAudioAssignment = typeof chapterAudioAssignments.$inferSelect

// ── FONOTECA ADAPTATIVA Y DIRECCIÓN NARRATIVA ──────────
// Las capas son exclusivamente musicales. No existen roles de SFX, foley o
// stinger: la música acompaña regiones amplias y nunca imita acciones.
export const adaptiveScores = pgTable("adaptive_scores", {
  id:            serial("id").primaryKey(),
  title:         text("title").notNull(),
  description:   text("description").notNull().default(""),
  bpm:           integer("bpm").notNull(),
  musicalKey:    text("musical_key").notNull().default(""),
  timeSignature: text("time_signature").notNull().default("4/4"),
  tags:          jsonb("tags").$type<string[]>().notNull().default([]),
  status:        text("status").notNull().default("draft"),
  createdBy:     integer("created_by").references(() => users.id),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
})

export const adaptiveScoreLayers = pgTable("adaptive_score_layers", {
  id:           serial("id").primaryKey(),
  scoreId:      integer("score_id").references(() => adaptiveScores.id, { onDelete: "cascade" }).notNull(),
  assetId:      integer("asset_id").references(() => audioAssets.id).notNull(),
  layerKey:     text("layer_key").notNull(),
  family:       text("family").notNull(),
  role:         text("role").notNull().default("stem"),
  intensityMin: real("intensity_min").notNull().default(0),
  intensityMax: real("intensity_max").notNull().default(1),
  defaultGain:  real("default_gain").notNull().default(0.5),
  syncBars:     integer("sync_bars").notNull().default(4),
  tags:         jsonb("tags").$type<string[]>().notNull().default([]),
  position:     integer("position").notNull().default(0),
}, (t) => ({
  uniqAdaptiveLayerKey: unique("uniq_adaptive_score_layer_key").on(t.scoreId, t.layerKey),
}))

export const narrativeProjects = pgTable("narrative_projects", {
  id:           serial("id").primaryKey(),
  bookId:       integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  revision:     integer("revision").notNull().default(1),
  // El hash ancla las regiones musicales a una versión exacta del manuscrito.
  // El valor vacío migra filas heredadas a un estado explícitamente stale.
  contentHash:  text("content_hash").notNull().default(""),
  data:         jsonb("data").$type<NarrativeProjectV1>().notNull(),
  createdBy:    integer("created_by").references(() => users.id),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqNarrativeProjectChapter: unique("uniq_narrative_project_chapter").on(t.bookId, t.chapterIndex),
}))

export const experienceProfiles = pgTable("experience_profiles", {
  id:                    serial("id").primaryKey(),
  bookId:                integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex:          integer("chapter_index").notNull(),
  revision:              integer("revision").notNull().default(1),
  sourceProjectRevision: integer("source_project_revision").notNull(),
  status:                text("status").notNull().default("draft"),
  data:                  jsonb("data").$type<ExperienceProfileV1>().notNull(),
  compiledBy:            integer("compiled_by").references(() => users.id),
  compiledAt:            timestamp("compiled_at").defaultNow().notNull(),
  publishedAt:           timestamp("published_at"),
}, (t) => ({
  uniqExperienceProfileChapter: unique("uniq_experience_profile_chapter").on(t.bookId, t.chapterIndex),
}))


export const voiceProfiles = pgTable("voice_profiles", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  provider: text("provider").notNull().default("elevenlabs"),
  providerVoiceId: text("provider_voice_id").notNull(),
  language: text("language").notNull().default("es"),
  role: text("role").notNull().default("both"),
  license: text("license").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqVoiceProviderId: unique("uniq_voice_provider_id").on(t.provider, t.providerVoiceId),
}))

export const speechProjects = pgTable("speech_projects", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  revision: integer("revision").notNull().default(1),
  contentHash: text("content_hash").notNull(),
  data: jsonb("data").$type<SpeechProjectV1>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqSpeechProjectChapter: unique("uniq_speech_project_chapter").on(t.bookId, t.chapterIndex),
}))

// ── PARTITURA AVANZADA Y DIRECTOR ARTIFICIAL ──────────
// El manuscrito canónico nunca se almacena aquí: sólo su hash y una capa
// lateral de dirección. Una propuesta del DA se revisa antes de convertirse
// en proyecto; request_key hace idempotente el cobro y los reintentos.
export const advancedDirectionProjects = pgTable("advanced_direction_projects", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  revision: integer("revision").notNull().default(1),
  contentHash: text("content_hash").notNull(),
  data: jsonb("data").$type<AdvancedDirectionProjectV2>().notNull(),
  createdBy: integer("created_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqAdvancedDirectionChapter: unique("uniq_advanced_direction_chapter").on(t.bookId, t.chapterIndex),
}))

export const directionAgentRuns = pgTable("direction_agent_runs", {
  id: serial("id").primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  bookId: integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  contentHash: text("content_hash").notNull(),
  mode: text("mode").notNull().default("replace_unlocked"),
  status: text("status").notNull().default("quoted"),
  promptVersion: text("prompt_version").notNull(),
  provider: text("provider").notNull().default(""),
  model: text("model").notNull().default(""),
  estimatedInputUnits: integer("estimated_input_units").notNull(),
  estimatedOutputUnits: integer("estimated_output_units").notNull(),
  estimatedPaper: integer("estimated_paper").notNull(),
  maximumPaper: integer("maximum_paper").notNull(),
  reservedPaper: integer("reserved_paper").notNull().default(0),
  actualInputUnits: integer("actual_input_units").notNull().default(0),
  actualOutputUnits: integer("actual_output_units").notNull().default(0),
  chargedPaper: integer("charged_paper").notNull().default(0),
  proposal: jsonb("proposal").$type<AdvancedDirectionProjectV2>(),
  errorCode: text("error_code").notNull().default(""),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
})

export const speechProfiles = pgTable("speech_profiles", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  revision: integer("revision").notNull().default(1),
  sourceProjectRevision: integer("source_project_revision").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull().default("draft"),
  characterCount: integer("character_count").notNull(),
  data: jsonb("data").$type<SpeechProfileV1>().notNull(),
  compiledBy: integer("compiled_by").references(() => users.id),
  compiledAt: timestamp("compiled_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
}, (t) => ({
  uniqSpeechProfileChapter: unique("uniq_speech_profile_chapter").on(t.bookId, t.chapterIndex),
}))

export const audiobookCache = pgTable("audiobook_cache", {
  id: serial("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(),
  bookId: integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  speechProfileRevision: integer("speech_profile_revision").notNull(),
  contentHash: text("content_hash").notNull(),
  modelId: text("model_id").notNull(),
  storageKey: text("storage_key").notNull().default(""),
  mimeType: text("mime_type").notNull().default("audio/mpeg"),
  durationSeconds: integer("duration_seconds"),
  characterCount: integer("character_count").notNull(),
  status: text("status").notNull().default("generating"),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const audiobookJobs = pgTable("audiobook_jobs", {
  id: serial("id").primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  cacheKey: text("cache_key").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  bookId: integer("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  speechProfileRevision: integer("speech_profile_revision").notNull(),
  contentHash: text("content_hash").notNull(),
  modelId: text("model_id").notNull(),
  status: text("status").notNull().default("queued"),
  estimatedPaper: integer("estimated_paper").notNull(),
  reservedPaper: integer("reserved_paper").notNull(),
  expectedCharacters: integer("expected_characters").notNull(),
  actualCharacters: integer("actual_characters").notNull().default(0),
  provider: text("provider").notNull().default("elevenlabs"),
  errorCode: text("error_code").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
})

export type VoiceProfile = typeof voiceProfiles.$inferSelect
export type SpeechProject = typeof speechProjects.$inferSelect
export type SpeechProfile = typeof speechProfiles.$inferSelect
export type AdvancedDirectionProject = typeof advancedDirectionProjects.$inferSelect
export type DirectionAgentRun = typeof directionAgentRuns.$inferSelect
export type AudiobookCache = typeof audiobookCache.$inferSelect
export type AudiobookJob = typeof audiobookJobs.$inferSelect

export type AdaptiveScore = typeof adaptiveScores.$inferSelect
export type AdaptiveScoreLayer = typeof adaptiveScoreLayers.$inferSelect
export type NarrativeProject = typeof narrativeProjects.$inferSelect
export type ExperienceProfile = typeof experienceProfiles.$inferSelect

// ── MARCOS (galería del Taller de Marcos) ────────────────
// Los crea el admin en el taller; los autores los desbloquean con Tinta.
// `pkg` guarda el paquete completo del taller (editableDefinition + runtimePreset),
// para poder re-editarlos y para que el renderer cargue el preset ligero.
export const frames = pgTable("frames", {
  id:            serial("id").primaryKey(),
  name:          text("name").notNull(),
  priceTinta:    integer("price_tinta").default(0).notNull(),   // 0 = gratis
  target:        text("target").default("both").notNull(),      // "card" | "profile" | "both"
  schemaVersion: text("schema_version").default("1.0.0").notNull(),
  fingerprint:   text("fingerprint").default(""),
  pkg:           jsonb("pkg").notNull(),                        // paquete del taller
  visible:       boolean("visible").default(true).notNull(),    // retirable sin borrar
  createdBy:     integer("created_by").references(() => users.id),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
})

// Marcos desbloqueados por cada usuario (compra con Tinta).
export const userFrames = pgTable("user_frames", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").references(() => users.id).notNull(),
  frameId:   integer("frame_id").references(() => frames.id).notNull(),
  source:    text("source").notNull().default("tinta"),         // "tinta" | "gift"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqUserFrame: unique("uniq_user_frame").on(t.userId, t.frameId),
}))

// ── EL SORTEO (gacha) ────────────────────────────────────
// Todo el sistema vive detrás de un interruptor: nace DORMIDO.
// Se enciende el día del lanzamiento oficial.
export const gachaConfig = pgTable("gacha_config", {
  id:          integer("id").primaryKey().default(1),      // fila única
  enabled:     boolean("enabled").default(false).notNull(),// ← el interruptor
  poolBalance: integer("pool_balance").default(0).notNull(),// el pozo, en Tinta
  ticketPrice: integer("ticket_price").default(10).notNull(),
  splitDirect: integer("split_direct").default(3).notNull(),
  splitPool:   integer("split_pool").default(4).notNull(),
  splitHouse:  integer("split_house").default(3).notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
})

// El contador de piedad de cada lector (su seguro contra la mala racha).
export const gachaPity = pgTable("gacha_pity", {
  userId:             integer("user_id").primaryKey().references(() => users.id),
  sinceGolden:        integer("since_golden").default(0).notNull(),
  sinceLegendary:     integer("since_legendary").default(0).notNull(),
  totalDraws:         integer("total_draws").default(0).notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
})

// Cada tirada queda registrada. Es el libro de auditoría del sorteo:
// permite reconstruir hasta el último centavo y demostrar que fue limpio.
export const gachaDraws = pgTable("gacha_draws", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").references(() => users.id).notNull(),
  cardId:       integer("card_id").references(() => bookCards.id),
  bookId:       integer("book_id").references(() => books.id),
  authorId:     integer("author_id").references(() => users.id),
  rarity:       text("rarity").notNull(),
  rolledRarity: text("rolled_rarity").notNull(),   // lo que salió ANTES de ajustes
  reason:       text("reason").notNull(),          // natural|pity|insolvent|no_stock
  ticketPrice:  integer("ticket_price").notNull(),
  paidDirect:   integer("paid_direct").notNull(),  // al autor, del boleto
  paidPool:     integer("paid_pool").notNull(),    // al pozo
  paidHouse:    integer("paid_house").notNull(),   // a Tloque
  bonusFromPool:integer("bonus_from_pool").notNull(), // al autor, del pozo
  poolBefore:   integer("pool_before").notNull(),
  poolAfter:    integer("pool_after").notNull(),
  wasDuplicate: boolean("was_duplicate").default(false).notNull(),
  paperGranted: integer("paper_granted").default(0).notNull(),
  bookGranted:  boolean("book_granted").default(false).notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
})

// Los géneros que el lector NO quiere que le toquen (hasta 3).
export const gachaExclusions = pgTable("gacha_exclusions", {
  userId:    integer("user_id").primaryKey().references(() => users.id),
  genres:    jsonb("genres").default([]).notNull(),   // ["terror", "romance"]
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type GachaConfig = typeof gachaConfig.$inferSelect
export type GachaDraw   = typeof gachaDraws.$inferSelect
export type GachaPity   = typeof gachaPity.$inferSelect

export type Frame = typeof frames.$inferSelect
export type UserFrame = typeof userFrames.$inferSelect

export type BookResponse      = Book
