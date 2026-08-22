import test from "node:test"
import assert from "node:assert/strict"
import { isSafeAudioSource, isSafeHttpsUrl, isSafeImageSource } from "../shared/media"

test("sólo acepta URLs HTTPS sin credenciales", () => {
  assert.equal(isSafeHttpsUrl("https://cdn.example.com/file.png"), true)
  assert.equal(isSafeHttpsUrl("http://cdn.example.com/file.png"), false)
  assert.equal(isSafeHttpsUrl("javascript:alert(1)"), false)
  assert.equal(isSafeHttpsUrl("https://user:pass@example.com/file"), false)
  assert.equal(isSafeHttpsUrl("https://example.com/" + "a".repeat(2_000)), false)
})

test("acepta imágenes raster seguras y rechaza SVG o datos mal formados", () => {
  assert.equal(isSafeImageSource(""), true)
  assert.equal(isSafeImageSource("data:image/png;base64,AAAA"), true)
  assert.equal(isSafeImageSource("data:image/webp;base64,AA=="), true)
  assert.equal(isSafeImageSource("data:image/svg+xml;base64,PHN2Zz4="), false)
  assert.equal(isSafeImageSource("data:text/html;base64,PGgxPkhlbGxvPC9oMT4="), false)
  assert.equal(isSafeImageSource("https://images.example.com/cover.webp"), true)
})

test("la Fonoteca acepta audio HTTPS y objetos internos de App Storage", () => {
  assert.equal(isSafeAudioSource("https://audio.example.com/track.mp3?sig=abc"), true)
  assert.equal(isSafeAudioSource("https://audio.example.com/track.opus"), true)
  assert.equal(isSafeAudioSource("https://audio.example.com/track.exe"), false)
  assert.equal(isSafeAudioSource("http://audio.example.com/track.mp3"), false)
  assert.equal(isSafeAudioSource("data:audio/mp3;base64,AAAA"), false)
  assert.equal(isSafeAudioSource(`/api/audio/uploads/${"a".repeat(64)}.wav`), true)
  assert.equal(isSafeAudioSource("/api/audio/uploads/../../secret.wav"), false)
})
