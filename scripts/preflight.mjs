import { createPool, inspectDatabase, RELEASE_ID } from "./db-common.mjs"

const pool = createPool()
let client
try {
  client = await pool.connect()
  const report = await inspectDatabase(client)
  console.log(`\nTloque · preflight ${RELEASE_ID}`)
  console.log(`Base: ${report.details.database || "desconocida"}`)
  console.log(`PostgreSQL: ${report.details.version || "desconocido"}`)
  console.log(`Migraciones registradas: ${report.details.recordedMigrations?.length || 0}`)

  if (report.warnings.length) {
    console.log("\nAdvertencias de configuración:")
    for (const warning of report.warnings) console.log(`- ${warning}`)
  }
  if (report.errors.length) {
    console.error("\nPreflight rechazado:")
    for (const error of report.errors) console.error(`- ${error}`)
    process.exitCode = 2
  } else {
    console.log("\nPreflight aprobado. La base puede recibir las migraciones.")
  }
} catch (error) {
  console.error(`\nNo se pudo revisar la base: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  client?.release()
  await pool.end()
}
