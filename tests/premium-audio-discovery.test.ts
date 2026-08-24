import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const adminHub = readFileSync("client/src/pages/AdminHub.tsx", "utf8")
const premiumHub = readFileSync("client/src/pages/KeyboardInstallerAdmin.tsx", "utf8")

test("admin center exposes premium instrument installation directly", () => {
  assert.match(adminHub, /Instrumentos premium/)
  assert.match(adminHub, /\/admin\/audio\/keyboards/)
})

test("premium instrument hub exposes all curated orchestral families", () => {
  assert.match(premiumHub, /Cuerdas/)
  assert.match(premiumHub, /\/admin\/audio\/vsco-strings/)
  assert.match(premiumHub, /Maderas/)
  assert.match(premiumHub, /\/admin\/audio\/vsco-woodwinds/)
  assert.match(premiumHub, /Metales/)
  assert.match(premiumHub, /\/admin\/audio\/vsco-brass/)
  assert.match(premiumHub, /Percusión/)
  assert.match(premiumHub, /\/admin\/audio\/vsco-percussion/)
  assert.match(premiumHub, /Barroco Premium · Vivaldi/)
  assert.match(premiumHub, /Instalar set Barroco Premium/)
})

test("premium hub verifies the actual manifest instead of trusting HEAD", () => {
  assert.match(premiumHub, /method: "GET"/)
  assert.match(premiumHub, /body\.instrumentManifestId === moduleId/)
  assert.match(premiumHub, /Array\.isArray\(body\.zones\)/)
})
