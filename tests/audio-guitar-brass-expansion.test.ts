import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const curated = readFileSync("shared/curated-sample-packs.ts", "utf8")
const manifests = readFileSync("shared/instrument-manifest.ts", "utf8")
const guitarManifest = readFileSync("shared/instrument-manifest-guitar.ts", "utf8")
const installer = readFileSync("client/src/pages/VscoInstallerAdmin.tsx", "utf8")
const hub = readFileSync("client/src/pages/KeyboardInstallerAdmin.tsx", "utf8")
const skill = readFileSync("client/public/downloads/TLOQUE_SCORE_AI_SKILL.md", "utf8")

test("native-auto exposes a verified premium clean electric guitar", () => {
  assert.match(curated, /karoryfer-emily-guitar/)
  assert.match(curated, /guitar\.electric-clean/)
  assert.match(curated, /emily_basic\.sfz/)
  assert.match(curated, /b4920dc662fd9cad6dcaccdeecffdd91c8725d8c/)
  assert.match(guitarManifest, /velocity-layers/)
  assert.match(guitarManifest, /round-robin/)
  assert.match(guitarManifest, /release-samples/)
  assert.match(manifests, /KARORYFER_EMILY_GUITAR_MANIFEST/)
})

test("premium UI makes guitar and full brass easy to install", () => {
  assert.match(hub, /Guitarra/)
  assert.match(hub, /guitar=1/)
  assert.match(installer, /Metales Premium completos/)
  assert.match(installer, /Instalar Metales Premium/)
  assert.match(installer, /Emilyguitar/)
  assert.match(installer, /family === "guitar"/)
})

test("AI skill documents guitar and brass physical capabilities", () => {
  const version = /Skill version: `(\d+)\.(\d+)\.(\d+)`/.exec(skill)
  assert.ok(version)
  assert.ok(Number(version![1]) > 1 || Number(version![2]) >= 4)
  assert.match(skill, /guitar\.electric-clean/)
  assert.match(skill, /VSCO 2 CE Trumpet/)
  assert.match(skill, /straight mute and Harmon mute/)
  assert.match(skill, /four recorded velocity layers, three note round robins/)
})
