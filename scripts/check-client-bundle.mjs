import { gzipSync } from "node:zlib"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const assetsDirectory = path.resolve("dist/public/assets")
const files = await readdir(assetsDirectory)
const appChunks = files.filter(name => /^App-[A-Za-z0-9_-]+\.js$/.test(name))

if (appChunks.length !== 1) {
  throw new Error(`Se esperaba un solo chunk App y se encontraron ${appChunks.length}`)
}

const appPath = path.join(assetsDirectory, appChunks[0])
const bytes = (await stat(appPath)).size
const gzipBytes = gzipSync(await readFile(appPath), { level: 9 }).byteLength
const maxBytes = 350_000
const maxGzipBytes = 120_000

if (bytes > maxBytes || gzipBytes > maxGzipBytes) {
  throw new Error(
    `El shell inicial excede el presupuesto: ${bytes} B / ${gzipBytes} B gzip `
    + `(máximo ${maxBytes} B / ${maxGzipBytes} B gzip)`,
  )
}

console.log(`Bundle inicial dentro del presupuesto: ${bytes} B / ${gzipBytes} B gzip`)
