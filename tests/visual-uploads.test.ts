import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import type { AddressInfo } from "node:net"
import type { Client } from "@replit/object-storage"
import { createLazyAudioStorage } from "../server/audioStorage"
import { modelFixture } from "./fixtures/animated-model"
process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/tloque_test"
const { registerVisualUploadRoutes } = await import("../server/visualUploads")

test("modelos: exige sesión, valida antes de guardar y recupera exactamente el GLB persistido", async () => {
  const assets = new Map<string, Buffer>(); let writes = 0, broken = false
  const fake = {
    exists: async (key: string) => ({ ok: true, value: assets.has(key) }),
    uploadFromBytes: async (key: string, data: Buffer) => { if (broken) throw new Error("offline"); writes++; assets.set(key, Buffer.from(data)); return { ok: true } },
    downloadAsStream: (key: string) => { if (!assets.has(key)) { const s = new Readable({ read() { this.destroy(new Error("missing")) } }); return s }; return Readable.from(assets.get(key)!) },
  } as unknown as Client
  const app = express()
  registerVisualUploadRoutes(app, { storage: createLazyAudioStorage(() => fake), reserve: async () => true, finish: async () => {}, authenticate: (req, res, next) => req.get("X-Fixture-User") ? next() : void res.status(401).end() })
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const bytes = modelFixture(), headers = { "Content-Type": "model/gltf-binary", "X-Fixture-User": "author" }
  try {
    const anon = await fetch(`${origin}/api/visual/models`, { method: "POST", headers: { "Content-Type": "model/gltf-binary" }, body: bytes })
    assert.equal(anon.status, 401); assert.equal(writes, 0)
    const bad = await fetch(`${origin}/api/visual/models`, { method: "POST", headers, body: modelFixture(d => { d.buffers[0].uri = "http://127.0.0.1/secret" }) })
    assert.equal(bad.status, 400); assert.equal(writes, 0)
    const response = await fetch(`${origin}/api/visual/models`, { method: "POST", headers, body: bytes })
    assert.equal(response.status, 201)
    const saved = await response.json() as any, hash = createHash("sha256").update(bytes).digest("hex")
    assert.equal(saved.source, `/api/visual/models/${hash}.glb`); assert.equal(saved.clips[0].duration, 18)
    const duplicate = await fetch(`${origin}/api/visual/models`, { method: "POST", headers, body: bytes })
    assert.equal(duplicate.status, 201); assert.equal(writes, 1)
    const fetched = await fetch(origin + saved.source)
    assert.equal(fetched.headers.get("Content-Type"), "model/gltf-binary")
    assert.equal(fetched.headers.get("X-Content-Type-Options"), "nosniff")
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), bytes)
    const invalid = await fetch(`${origin}/api/visual/models/not-a-hash.glb`); assert.equal(invalid.status, 404)
    const missing = await fetch(`${origin}/api/visual/models/${"a".repeat(64)}.glb`); assert.equal(missing.status, 404); assert.equal(missing.headers.get("Cache-Control"), "no-store")
    broken = true
    const failed = await fetch(`${origin}/api/visual/models`, { method: "POST", headers, body: modelFixture(d => { d.nodes[0].name = "new" }) })
    assert.equal(failed.status, 503); assert.match((await failed.json() as any).message, /No se pudo guardar/)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
