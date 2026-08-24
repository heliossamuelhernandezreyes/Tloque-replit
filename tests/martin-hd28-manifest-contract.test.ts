import test from "node:test"
import assert from "node:assert/strict"
import { instrumentManifestById } from "../shared/instrument-manifest"

test("Martin HD28 declara sólo capacidades físicamente presentes", () => {
  const manifest = instrumentManifestById("discord-martin-hd28")
  assert.ok(manifest)
  assert.deepEqual(manifest.capabilities, [])
  assert.deepEqual(manifest.articulations, [{ articulation: "normal" }])
  assert.deepEqual(manifest.instruments, ["guitar.acoustic"])
})
