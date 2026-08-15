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
    sourcemap: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "info",
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
