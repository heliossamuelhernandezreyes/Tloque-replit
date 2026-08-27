import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

test("el migrador seguro incluye todas las migraciones SQL versionadas", () => {
  const migrationFiles = readdirSync(join(process.cwd(), "migrations"))
    .filter(file => /^\d{4}_.+\.sql$/.test(file))
    .sort()
  const migrator = readFileSync(join(process.cwd(), "scripts", "migrate.mjs"), "utf8")
  for (const migration of migrationFiles) {
    assert.match(migrator, new RegExp(`['\"]${migration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['\"]`), `${migration} falta en el migrador`)
  }
})

test("la migración editorial crea historial, borrador, límite distribuido e instantánea económica", () => {
  const sql = readFileSync(join(process.cwd(), "migrations", "0012_manuscript_integrity.sql"), "utf8")
  for (const contract of [
    /ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1/i,
    /CREATE TABLE IF NOT EXISTS book_revisions/i,
    /UNIQUE \(book_id, revision\)/i,
    /CREATE TABLE IF NOT EXISTS book_drafts/i,
    /CREATE TABLE IF NOT EXISTS api_rate_limits/i,
    /author_share_bps/i,
    /book_revision_snapshot/i,
    /refunded_at/i,
  ]) assert.match(sql, contract)
})
