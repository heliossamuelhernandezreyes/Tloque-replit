import { pgTable, text, serial, boolean, timestamp, jsonb, integer, unique, real } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type User       = typeof users.$inferSelect
export type InsertUser = typeof users.$inferInsert

// ── ADMINISTRADORES ───────────────────────────────────────
// Tabla para gestionar quién tiene permisos de admin.
// El fundador (heliossamuel17@gmail.com) se auto-inserta al arrancar.
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
  title:   z.string(),
  content: z.string(),
})
export type Chapter = z.infer<typeof chapterSchema>


export const coverFxLayerSchema = z.object({
  back:  z.string().optional().default(""),
  mid:   z.string().optional().default(""),
  front: z.string().optional().default(""),
})

export const coverFxSchema = z.object({
  mode:   z.enum(["simple", "layered"]).default("simple"),
  layers: coverFxLayerSchema.default({}),
})

export type CoverFx = z.infer<typeof coverFxSchema>

// ── LIBROS ────────────────────────────────────────────────
export const books = pgTable("books", {
  id:              serial("id").primaryKey(),
  title:           text("title").notNull(),
  author:          text("author").notNull(),
  authorId:        integer("author_id").references(() => users.id),
  coverUrl:        text("cover_url").notNull().default(""),
  coverFx:         jsonb("cover_fx").$type<CoverFx>().default({ mode: "simple", layers: {} }),
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
  chapters: z.array(chapterSchema).default([]),
  coverFx:  coverFxSchema.optional().default({ mode: "simple", layers: {} }),
}).omit({ id: true, createdAt: true, updatedAt: true })

export type Book              = typeof books.$inferSelect
export type InsertBook        = z.infer<typeof insertBookSchema>
export type CreateBookRequest = InsertBook
export type UpdateBookRequest = Partial<InsertBook>

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
// currency: "tinta" (comprar tokens) | "papel" (Oráculo/audiolibros,
// latente — la moneda existe desde hoy, sus reglas llegarán después).
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
  cardId:    integer("card_id").references(() => bookCards.id).notNull(),
  source:    text("source").notNull().default("support"),     // "support" | "tinta"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqUserCard: unique("uniq_user_card").on(t.userId, t.cardId),
}))

export type BookCard = typeof bookCards.$inferSelect
export type UserCard = typeof userCards.$inferSelect

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
  ticketPrice: integer("ticket_price").default(40).notNull(),
  splitDirect: integer("split_direct").default(16).notNull(),
  splitPool:   integer("split_pool").default(12).notNull(),
  splitHouse:  integer("split_house").default(12).notNull(),
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
