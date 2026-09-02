import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const canonicalPath = resolve(root, "skills/tloque-score/SKILL.md")
const downloadPath = resolve(root, "client/public/downloads/TLOQUE_SCORE_AI_SKILL.md")
const canonical = await readFile(canonicalPath, "utf8")

if (process.argv.includes("--check")) {
  const download = await readFile(downloadPath, "utf8")
  if (download !== canonical) {
    console.error("La skill descargable está desincronizada. Ejecuta: npm run sync:score-skill")
    process.exitCode = 1
  }
} else {
  await writeFile(downloadPath, canonical, "utf8")
}
