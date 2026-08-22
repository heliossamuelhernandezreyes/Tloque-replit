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
