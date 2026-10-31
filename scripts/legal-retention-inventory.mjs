import { createPool } from "./db-common.mjs"
import { retentionInventory } from "./retention-inventory.mjs"

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === "--help") {
  console.log("Uso: npm run legal:retention:inventory -- --user-id 123\nSolo lectura; requiere DATABASE_URL del entorno revisado. Devuelve conteos, sin textos ni contactos.")
} else {
  if (args.length !== 2 || args[0] !== "--user-id" || !/^[1-9]\d*$/.test(args[1])) throw new Error("Usa --user-id con un entero positivo; no hay opción de borrado")
  const userId = Number(args[1])
  if (!Number.isSafeInteger(userId)) throw new Error("ID fuera de rango")
  const pool = createPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const report = await retentionInventory(client, userId)
    await client.query("COMMIT")
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally { client.release(); await pool.end() }
}
