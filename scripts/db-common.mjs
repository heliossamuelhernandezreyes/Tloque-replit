import pg from "pg"

const { Pool } = pg

export const RELEASE_ID = "tloque-replit-2026-08-27-production-hardening"

export const BASE_TABLES = [
  "users",
  "books",
  "book_tokens",
  "print_copies",
  "wallet_ledger",
  "book_cards",
  "user_cards",
  "gacha_config",
]

export const BASE_COLUMNS = {
  users: ["id"],
  books: ["id", "status", "genre", "is_classic", "author_id", "gutenberg_id"],
  book_tokens: ["id"],
  print_copies: ["id"],
  wallet_ledger: ["id", "ref_id", "ref_type", "reason"],
  book_cards: ["id"],
  user_cards: ["id", "card_id"],
  gacha_config: [
    "id", "pool_balance", "ticket_price", "split_direct", "split_pool",
    "split_house", "updated_at",
  ],
}

export const EXPECTED_TABLES = [
  "adaptive_score_layers",
  "adaptive_scores",
  "advanced_direction_projects",
  "audio_assets",
  "audio_favorites",
  "audiobook_cache",
  "audiobook_jobs",
  "chapter_audio_assignments",
  "direction_agent_runs",
  "book_drafts",
  "book_revisions",
  "api_rate_limits",
  "author_payout_accounts",
  "author_payouts",
  "experience_profiles",
  "narrative_projects",
  "notifications",
  "paper_usage_events",
  "print_copy_events",
  "speech_profiles",
  "speech_projects",
  "voice_profiles",
]

export const EXPECTED_INDEXES = [
  "audio_assets_status_kind_idx",
  "chapter_audio_book_idx",
  "audio_favorites_user_idx",
  "wallet_ledger_wallet_purchase_once_idx",
  "paper_usage_user_created_idx",
  "adaptive_scores_status_idx",
  "adaptive_score_layers_score_idx",
  "narrative_projects_book_idx",
  "experience_profiles_book_status_idx",
  "audiobook_jobs_one_active_cache_idx",
  "voice_profiles_catalog_idx",
  "speech_projects_book_idx",
  "speech_profiles_ready_idx",
  "audiobook_cache_chapter_idx",
  "audiobook_jobs_user_idx",
  "print_copy_events_copy_created_idx",
  "notifications_user_created_idx",
  "notifications_user_unread_idx",
  "notifications_user_dedupe_idx",
  "books_status_idx",
  "books_genre_idx",
  "books_is_classic_idx",
  "books_author_id_idx",
  "books_gutenberg_id_idx",
  "books_gutenberg_id_unique_idx",
  "advanced_direction_projects_book_idx",
  "direction_agent_runs_user_idx",
  "direction_agent_one_active_request_idx",
  "audio_assets_source_type_idx",
  "book_drafts_author_updated_idx",
  "book_revisions_book_created_idx",
  "api_rate_limits_expires_idx",
  "author_payouts_one_active_idx",
  "author_payouts_status_requested_idx",
  "author_earnings_payout_ready_idx",
  "wallet_ledger_tinta_refund_once_idx",
]

export const EXPECTED_CONSTRAINTS = [
  "audio_assets_kind_check",
  "audio_assets_source_type_check",
  "adaptive_layers_values_check",
  "audiobook_cache_contract_check",
  "audiobook_cache_storage_key_check",
  "direction_runs_contract_check",
  "book_revisions_contract_check",
  "book_drafts_contract_check",
  "token_orders_cash_backing_range",
  "author_earnings_status_valid",
  "author_payout_accounts_contract_check",
  "author_payouts_contract_check",
  "gacha_config_split_check",
]

export function databaseUrl() {
  const value = String(process.env.DATABASE_URL || "").trim()
  if (!value) {
    throw new Error("DATABASE_URL no está disponible. Revisa Secrets en Replit.")
  }
  return value
}

export function createPool() {
  return new Pool({
    connectionString: databaseUrl(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
  })
}

export async function tableExists(client, table) {
  const result = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`])
  return Boolean(result.rows[0]?.name)
}

export async function columnExists(client, table, column) {
  const result = await client.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
  `, [table, column])
  return result.rowCount > 0
}

async function count(client, query, params = []) {
  const result = await client.query(query, params)
  return Number(result.rows[0]?.count || 0)
}

export async function inspectDatabase(client, { allowEmpty = false } = {}) {
  const errors = []
  const warnings = []
  const details = {}

  const identity = await client.query(`
    SELECT current_database() AS database,
           current_setting('server_version') AS version,
           current_setting('server_version_num')::integer AS version_num
  `)
  details.database = identity.rows[0]?.database || "unknown"
  details.version = identity.rows[0]?.version || "unknown"
  if (Number(identity.rows[0]?.version_num || 0) < 120000) {
    errors.push("PostgreSQL 12 o superior es obligatorio.")
  }

  const missingBase = []
  for (const table of BASE_TABLES) {
    if (!(await tableExists(client, table))) missingBase.push(table)
  }
  details.missingBaseTables = missingBase
  if (missingBase.length) {
    const existing = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('tloque_schema_migrations', 'tloque_migration_backups')
      ORDER BY table_name
    `)
    details.existingApplicationTables = existing.rows.map(row => row.table_name)
    details.emptyDatabase = existing.rowCount === 0
    if (allowEmpty && details.emptyDatabase) {
      if (!process.env.APP_URL) warnings.push("APP_URL no está visible en este Shell; será obligatorio al publicar.")
      return { errors, warnings, details }
    }
    errors.push(`Faltan tablas base: ${missingBase.join(", ")}. No se ejecutará ninguna migración.`)
    return { errors, warnings, details }
  }
  details.emptyDatabase = false

  const missingBaseColumns = []
  for (const [table, columns] of Object.entries(BASE_COLUMNS)) {
    for (const column of columns) {
      if (!(await columnExists(client, table, column))) {
        missingBaseColumns.push(`${table}.${column}`)
      }
    }
  }
  details.missingBaseColumns = missingBaseColumns
  if (missingBaseColumns.length) {
    errors.push(`Faltan columnas base: ${missingBaseColumns.join(", ")}. No se ejecutará ninguna migración.`)
    return { errors, warnings, details }
  }

  const duplicatePurchases = await client.query(`
    SELECT ref_id, count(*)::integer AS copies
    FROM wallet_ledger
    WHERE ref_type = 'wallet_order' AND reason = 'purchase' AND ref_id IS NOT NULL
    GROUP BY ref_id
    HAVING count(*) > 1
    ORDER BY copies DESC, ref_id
    LIMIT 10
  `)
  details.duplicateWalletPurchases = duplicatePurchases.rows
  if (duplicatePurchases.rowCount) {
    errors.push("Hay compras de monedero duplicadas. Deben corregirse antes de crear el índice idempotente.")
  }

  const orphanCards = await client.query(`
    SELECT uc.id, uc.card_id
    FROM user_cards uc
    LEFT JOIN book_cards bc ON bc.id = uc.card_id
    WHERE bc.id IS NULL
    ORDER BY uc.id
    LIMIT 10
  `)
  details.orphanUserCards = orphanCards.rows
  if (orphanCards.rowCount) {
    errors.push("Hay tarjetas de usuario sin tarjeta de catálogo. Deben corregirse antes de reconstruir la clave foránea.")
  }

  const invalidGacha = await count(client, `
    SELECT count(*)
    FROM gacha_config
    WHERE pool_balance < 0 OR ticket_price <= 0
       OR split_direct < 0 OR split_pool < 0 OR split_house < 0
       OR split_direct + split_pool + split_house <> ticket_price
  `)
  details.invalidGachaRows = invalidGacha
  if (invalidGacha) errors.push("gacha_config contiene valores incompatibles con las nuevas restricciones.")

  if (await columnExists(client, "users", "subscription_plan")) {
    const invalidPlans = await count(client, `
      SELECT count(*) FROM users
      WHERE subscription_plan NOT IN ('reader', 'aesthetic', 'audio')
    `)
    details.invalidSubscriptionPlans = invalidPlans
    if (invalidPlans) errors.push("Hay planes de suscripción desconocidos en users.subscription_plan.")
  }

  if (await columnExists(client, "users", "subscription_status")) {
    const invalidStatuses = await count(client, `
      SELECT count(*) FROM users
      WHERE subscription_status NOT IN ('inactive', 'active', 'past_due', 'canceled')
    `)
    details.invalidSubscriptionStatuses = invalidStatuses
    if (invalidStatuses) errors.push("Hay estados desconocidos en users.subscription_status.")
  }

  if (await tableExists(client, "audiobook_cache")) {
    const invalidReadyAudio = await count(client, `
      SELECT count(*) FROM audiobook_cache
      WHERE status = 'ready' AND
        (storage_key = '' OR storage_key ~ '(^/|\\\\|(^|/)\\.\\.?(/|$))')
    `)
    details.invalidReadyAudiobooks = invalidReadyAudio
    if (invalidReadyAudio) errors.push("Hay audiolibros listos con una clave de almacenamiento insegura o vacía.")
  }

  if (await tableExists(client, "notifications")
      && await columnExists(client, "notifications", "dedupe_key")) {
    const notificationDuplicates = await count(client, `
      SELECT count(*) FROM (
        SELECT user_id, dedupe_key
        FROM notifications
        WHERE dedupe_key <> ''
        GROUP BY user_id, dedupe_key
        HAVING count(*) > 1
      ) duplicate_keys
    `)
    details.duplicateNotificationKeys = notificationDuplicates
    if (notificationDuplicates) errors.push("Hay claves de deduplicación repetidas en notifications.")
  }

  if (await columnExists(client, "books", "gutenberg_id")) {
    const duplicateGutenbergIds = await count(client, `
      SELECT count(*) FROM (
        SELECT gutenberg_id
        FROM books
        WHERE gutenberg_id IS NOT NULL
        GROUP BY gutenberg_id
        HAVING count(*) > 1
      ) duplicate_ids
    `)
    details.duplicateGutenbergIds = duplicateGutenbergIds
    if (duplicateGutenbergIds) {
      errors.push("Hay IDs de Project Gutenberg repetidos en books; deben revisarse antes de crear el índice único.")
    }
  }

  if (await tableExists(client, "tloque_schema_migrations")) {
    const applied = await client.query(`
      SELECT migration_id, checksum, applied_at
      FROM tloque_schema_migrations
      ORDER BY migration_id
    `)
    details.recordedMigrations = applied.rows
  } else {
    details.recordedMigrations = []
  }

  if (!process.env.APP_URL) warnings.push("APP_URL no está visible en este Shell; será obligatorio al publicar.")
  if (!process.env.SESSION_SECRET || String(process.env.SESSION_SECRET).length < 32) {
    warnings.push("SESSION_SECRET no está visible o tiene menos de 32 caracteres; producción no iniciará así.")
  }
  if (!process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL === "admin@example.com") {
    warnings.push("ADMIN_EMAIL no está configurado para el fundador; producción no iniciará así.")
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    warnings.push("Faltan credenciales de Google OAuth; el inicio de sesión no funcionará en producción.")
  }

  return { errors, warnings, details }
}

export async function validateExpectedSchema(client) {
  const errors = []
  for (const table of EXPECTED_TABLES) {
    if (!(await tableExists(client, table))) errors.push(`Falta la tabla ${table}`)
  }

  const requiredColumns = {
    users: ["subscription_plan", "subscription_status", "subscription_expires_at", "deleted_at"],
    print_copies: ["sale_status", "sold_at", "sale_price_cents", "sale_channel", "sale_note", "updated_at"],
    audiobook_cache: ["cache_key", "storage_key", "status", "content_hash"],
    audiobook_jobs: ["request_key", "reserved_paper", "status", "content_hash"],
    notifications: ["user_id", "kind", "title", "body", "destination", "dedupe_key", "read_at"],
    advanced_direction_projects: ["book_id", "chapter_index", "revision", "content_hash", "data"],
    direction_agent_runs: ["request_key", "status", "maximum_paper", "reserved_paper", "proposal", "expires_at"],
    books: ["revision", "updated_at"],
    book_drafts: ["book_id", "author_id", "base_revision", "draft_revision", "data", "updated_at"],
    book_revisions: ["book_id", "revision", "snapshot", "change_type", "created_by", "created_at"],
    api_rate_limits: ["bucket_key", "window_start", "request_count", "expires_at"],
    token_orders: ["author_user_id", "author_share_bps", "book_type_snapshot", "book_revision_snapshot", "cash_backing_cents", "refund_ref", "refunded_at"],
    wallet_ledger: ["cash_backing_cents"],
    author_earnings: ["payout_eligible", "payout_id"],
    author_payout_accounts: ["user_id", "provider_account_id", "details_submitted", "payouts_enabled", "transfers_active", "requirements_due"],
    author_payouts: ["author_user_id", "amount_cents", "currency", "status", "provider_ref", "failure_code"],
  }
  for (const [table, columns] of Object.entries(requiredColumns)) {
    for (const column of columns) {
      if (!(await columnExists(client, table, column))) errors.push(`Falta ${table}.${column}`)
    }
  }

  for (const index of EXPECTED_INDEXES) {
    const result = await client.query("SELECT to_regclass($1) AS name", [`public.${index}`])
    if (!result.rows[0]?.name) errors.push(`Falta el índice ${index}`)
  }
  for (const constraint of EXPECTED_CONSTRAINTS) {
    const result = await client.query(`
      SELECT 1 FROM pg_constraint WHERE conname = $1
    `, [constraint])
    if (!result.rowCount) errors.push(`Falta la restricción ${constraint}`)
  }
  return errors
}
