import test from "node:test"
import assert from "node:assert/strict"
import { validateFrame } from "../server/frames"

test("acepta un paquete de marco acotado", () => {
  const result = validateFrame({
    name: "Oro lunar", priceTinta: 35, target: "both",
    pkg: { schemaVersion: "1.0.0", fingerprint: "abc", runtimePreset: { target: "both", appearance: {} } },
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.frame.name, "Oro lunar")
    assert.equal(result.frame.priceTinta, 35)
    assert.equal(result.frame.target, "both")
  }
})

test("rechaza prototipos peligrosos, profundidad y runtime ausente", () => {
  const polluted = JSON.parse('{"runtimePreset":{},"__proto__":{"admin":true}}')
  assert.equal(validateFrame({ name: "Malo", pkg: polluted }).ok, false)

  let deep: any = { runtimePreset: {} }
  for (let i = 0; i < 20; i++) deep = { child: deep }
  assert.equal(validateFrame({ name: "Profundo", pkg: deep }).ok, false)
  assert.equal(validateFrame({ name: "Sin runtime", pkg: { schemaVersion: "1" } }).ok, false)
})

test("acota precio, nombre y target", () => {
  const result = validateFrame({
    name: "x".repeat(100), priceTinta: 99_999, target: "unknown",
    pkg: { runtimePreset: {} },
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.frame.name.length, 60)
    assert.equal(result.frame.priceTinta, 1_000)
    assert.equal(result.frame.target, "both")
  }
})
