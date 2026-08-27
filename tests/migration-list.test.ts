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

test("una base vacía nace del snapshot canónico sin depender de db:push", () => {
  const baseline = readFileSync(join(process.cwd(), "migrations", "0000_canonical_base.sql"), "utf8")
  const migrator = readFileSync(join(process.cwd(), "scripts", "migrate.mjs"), "utf8")
  const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "editor-p0-check.yml"), "utf8")
  assert.match(baseline, /CREATE TABLE "users"/i)
  assert.match(baseline, /CREATE TABLE "author_payouts"/i)
  assert.doesNotMatch(baseline, /statement-breakpoint/i)
  assert.match(migrator, /emptyDatabase[\s\S]*baselineSql/i)
  const emptyRehearsal = workflow.match(/Rehearse database from empty PostgreSQL[\s\S]*?(?=\n\s{6}- name:)/)?.[0] || ""
  assert.match(emptyRehearsal, /npm run db:migrate/i)
  assert.doesNotMatch(emptyRehearsal, /drizzle-kit push/i)
})

test("la capa canónica repone restricciones que Drizzle no expresa", () => {
  const sql = readFileSync(join(process.cwd(), "migrations", "0014_canonical_constraints.sql"), "utf8")
  for (const contract of [
    /audio_assets_source_type_check|audio_assets_kind_check/i,
    /adaptive_layers_values_check/i,
    /audiobook_cache_contract_check/i,
    /direction_runs_contract_check/i,
    /author_payouts_contract_check/i,
  ]) assert.match(sql, contract)
})
