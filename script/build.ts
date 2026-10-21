import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { build as esbuild } from "esbuild"
import { build as viteBuild } from "vite"

async function main() {
  await rm("dist", { recursive: true, force: true })
  await viteBuild()
  // Immutable build filenames make the offline print bundle explicit. Cache
  // the shell, book page, studio, worker and fonts, without downloading audio.
  const manifest = JSON.parse(await readFile("dist/public/.vite/manifest.json", "utf8"))
  const assets = new Set<string>(), seen = new Set<string>()
  const include = (key: string) => {
    if (seen.has(key) || !manifest[key]) return
    seen.add(key)
    const entry = manifest[key]
    assets.add("/" + entry.file)
    for (const file of entry.css || []) assets.add("/" + file)
    for (const dependency of entry.imports || []) include(dependency)
  }
  Object.keys(manifest).filter(key => key === "index.html" || /(?:App|pages\/book|print\/PrintStudio)\.tsx$/.test(key)).forEach(include)
  for (const name of await readdir("dist/public/assets")) if (/^(?:print\.worker-|SourceSerif4-|DejaVuSans-)/.test(name)) assets.add("/assets/" + name)
  const files = [...assets].sort()
  const worker = files.find(path => /\/print\.worker-.*\.js$/.test(path))
  if (!worker) throw new Error("Print worker missing from build")
  await writeFile("dist/public/print-assets.json", JSON.stringify({ version: 2, build: createHash("sha256").update(files.join("\n")).digest("hex"), worker, assets: files }))
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    packages: "external",
    // El servidor compilado siempre sirve el cliente ya construido. Mantener
    // Vite fuera del bundle evita incluir su configuración con top-level await
    // y conserva el arranque CJS compatible con Replit.
    external: ["./vite"],
    sourcemap: true,
    logLevel: "info",
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
