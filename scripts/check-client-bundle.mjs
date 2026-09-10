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

// A small App file alone is insufficient if a shared vendor eagerly imports Three.
const manifest = JSON.parse(await readFile(path.resolve("dist/public/.vite/manifest.json"), "utf8"))
const appEntry = Object.keys(manifest).find(key => manifest[key].file === `assets/${appChunks[0]}`)
if (!appEntry) throw new Error("Falta App en el manifiesto de compilación")
const seen = new Set()
function visit(key) {
  if (seen.has(key)) return
  seen.add(key)
  const chunk = manifest[key]
  if (!chunk) throw new Error(`Dependencia ausente del manifiesto: ${key}`)
  if (/visual-3d|VisualSurface/.test(chunk.file)) throw new Error("El motor 3D se coló en las dependencias estáticas del shell")
  for (const dependency of chunk.imports ?? []) visit(dependency)
}
visit(appEntry)
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key)
const visualChunks = files.filter(name => /^(visual-3d|VisualSurface)-.*\.js$/.test(name))
if (visualChunks.length !== 2) throw new Error("Se esperaban el renderizador y sus escenas como dos bloques diferidos")
let visualGzip = 0
for (const chunk of visualChunks) visualGzip += gzipSync(await readFile(path.join(assetsDirectory, chunk)), { level: 9 }).byteLength
if (visualGzip > 300_000) throw new Error(`El 3D diferido excede 300 KB gzip: ${visualGzip} B`)
console.log(`3D diferido: ${visualGzip} B gzip; sin importación estática desde el shell`)
