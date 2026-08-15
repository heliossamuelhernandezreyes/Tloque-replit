import { rm } from "node:fs/promises"
import { build as esbuild } from "esbuild"
import { build as viteBuild } from "vite"

async function main() {
  await rm("dist", { recursive: true, force: true })
  await viteBuild()
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
