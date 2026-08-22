import test from "node:test"
import assert from "node:assert/strict"
import { AUDIO_MODULE_SOURCES, AUDIO_SOURCE_REGISTRY_VERSION } from "../shared/audio-module-sources"
import { detectSoundBankType } from "../server/soundBankDetection"
import { isSafeSoundBankSource } from "../shared/media"

function riff(form: "sfbk" | "DLS ", major = 2) {
  const bytes = Buffer.alloc(32)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(24, 4)
  bytes.write(form, 8, "ascii")
  if (form === "sfbk") {
    bytes.write("ifil", 12, "ascii")
    bytes.writeUInt32LE(4, 16)
    bytes.writeUInt16LE(major, 20)
  }
  return bytes
}

test("el registro musical conserva procedencia, licencia y decisión explícitas", () => {
  assert.equal(AUDIO_SOURCE_REGISTRY_VERSION, "tloque-audio-sources-2026-08-v1")
  assert.equal(new Set(AUDIO_MODULE_SOURCES.map(source => source.id)).size, AUDIO_MODULE_SOURCES.length)
  assert.ok(AUDIO_MODULE_SOURCES.some(source => source.status === "integrated"))
  assert.ok(AUDIO_MODULE_SOURCES.some(source => source.status === "conversion"))
  assert.ok(AUDIO_MODULE_SOURCES.some(source => source.status === "excluded"))
  for (const source of AUDIO_MODULE_SOURCES) {
    assert.match(source.repositoryUrl, /^https:\/\/github\.com\//)
    assert.ok(source.license.length >= 3)
    assert.ok(source.decision.length >= 20)
    assert.ok(source.formats.length > 0)
  }
})

test("el importador reconoce bancos por contenido y no sólo por extensión", () => {
  assert.deepEqual(detectSoundBankType(riff("sfbk", 2), "orquesta.sf2")?.extension, "sf2")
  assert.deepEqual(detectSoundBankType(riff("sfbk", 3), "orquesta.bin")?.extension, "sf3")
  assert.deepEqual(detectSoundBankType(riff("DLS "), "orquesta.dls")?.extension, "dls")
  assert.equal(detectSoundBankType(Buffer.from("no es un banco"), "engaño.sf2"), null)
})

test("sólo admite módulos internos inmutables o bancos HTTPS compatibles", () => {
  const sha = "a".repeat(64)
  assert.equal(isSafeSoundBankSource(`/api/audio/modules/${sha}.sf3`), true)
  assert.equal(isSafeSoundBankSource("https://cdn.example.com/orchestra.sf2"), true)
  assert.equal(isSafeSoundBankSource(`/api/audio/modules/../${sha}.sf3`), false)
  assert.equal(isSafeSoundBankSource("http://cdn.example.com/orchestra.sf2"), false)
  assert.equal(isSafeSoundBankSource("https://cdn.example.com/orchestra.zip"), false)
})
