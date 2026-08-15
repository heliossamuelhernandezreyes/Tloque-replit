import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  createPool,
  inspectDatabase,
  RELEASE_ID,
  tableExists,
  validateExpectedSchema,
} from "./db-common.mjs"

if (!process.argv.includes("--apply")) {
  console.error("Ejecución bloqueada. Usa: node scripts/migrate.mjs --apply")
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(here)
const migrations = [
  "0001_fonoteca_and_hardening.sql",
  "0002_paper_usage.sql",
  "0003_adaptive_fonoteca.sql",
  "0004_speech_and_audiobook_cache.sql",
  "0005_security_entitlements_and_ticket.sql",
  "0006_experience_roles_editions_inbox.sql",
  "0007_catalog_indexes.sql",
  "0008_gutenberg_integrity.sql",
  "0009_direction_agent_v2.sql",
]

const pool = createPool()
const client = await pool.connect()
let transactionOpen = false

try {
  await client.query("BEGIN")
  transactionOpen = true
  await client.query("SET LOCAL lock_timeout = '15s'")
  await client.query("SET LOCAL statement_timeout = '180s'")
  await client.query("SELECT pg_advisory_xact_lock(84673, 7001)")

  const preflight = await inspectDatabase(client)
  if (preflight.errors.length) {
    throw new Error(`Preflight rechazado: ${preflight.errors.join(" | ")}`)
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS tloque_schema_migrations (
      migration_id text PRIMARY KEY,
      checksum text NOT NULL,
      release_id text NOT NULL,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS tloque_migration_backups (
      backup_id text PRIMARY KEY,
      release_id text NOT NULL,
      snapshot jsonb NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `)

  const snapshot = { releaseId: RELEASE_ID, gachaConfig: [], previousMigrations: [] }
  if (await tableExists(client, "gacha_config")) {
    snapshot.gachaConfig = (await client.query("SELECT * FROM gacha_config ORDER BY id")).rows
  }
  snapshot.previousMigrations = (await client.query(`
    SELECT migration_id, checksum, release_id, applied_at
    FROM tloque_schema_migrations
    ORDER BY migration_id
  `)).rows
  await client.query(`
    INSERT INTO tloque_migration_backups (backup_id, release_id, snapshot)
    VALUES ($1, $2, $3::jsonb)
  `, [`${RELEASE_ID}-${randomUUID()}`, RELEASE_ID, JSON.stringify(snapshot)])

  const applied = []
  const skipped = []
  for (const migration of migrations) {
    const sql = await readFile(join(projectRoot, "migrations", migration), "utf8")
    const checksum = createHash("sha256").update(sql).digest("hex")
    const prior = await client.query(`
      SELECT checksum FROM tloque_schema_migrations WHERE migration_id = $1
    `, [migration])
    if (prior.rowCount) {
      if (prior.rows[0].checksum !== checksum) {
        throw new Error(`La migración ${migration} cambió después de aplicarse. No se continuará.`)
      }
      skipped.push(migration)
      continue
    }
    await client.query(sql)
    await client.query(`
      INSERT INTO tloque_schema_migrations (migration_id, checksum, release_id)
      VALUES ($1, $2, $3)
    `, [migration, checksum, RELEASE_ID])
    applied.push(migration)
  }

  const schemaErrors = await validateExpectedSchema(client)
  if (schemaErrors.length) throw new Error(`Verificación final rechazada: ${schemaErrors.join(" | ")}`)

  await client.query("COMMIT")
  transactionOpen = false
  console.log("\nMigración completada correctamente.")
  console.log(`Aplicadas: ${applied.length ? applied.join(", ") : "ninguna"}`)
  console.log(`Ya presentes: ${skipped.length ? skipped.join(", ") : "ninguna"}`)
  console.log("La estructura final y los índices fueron verificados antes del commit.")
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined)
  console.error(`\nMigración cancelada y revertida: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
