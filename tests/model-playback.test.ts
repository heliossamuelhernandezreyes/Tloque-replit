import test from "node:test"
import assert from "node:assert/strict"
import { SkinnedMesh } from "three"
import { loadSceneModel } from "../client/src/visual/model-loader"
import type { SceneObject } from "../shared/scene-content"
import { inspectGlb } from "../shared/validate-glb"
import { modelFixture } from "./fixtures/animated-model"

test("GLTFLoader reproduce el esqueleto, clips completos, morph y búsqueda inversa sin deriva", async () => {
  const bytes = modelFixture(), original = globalThis.fetch
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { "Content-Type": "model/gltf-binary" } })
  const object: Extract<SceneObject, { kind: "model" }> = { id: "g", name: "Escena", kind: "model", source: `/api/visual/models/${"f".repeat(64)}.glb`, clips: inspectGlb(bytes).clips, clip: 0, loop: false, placement: "scene", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, speed: 1, motion: "still" }
  let loaded: Awaited<ReturnType<typeof loadSceneModel>> | undefined
  try {
    loaded = await loadSceneModel(object.source, new AbortController().signal)
    const root = loaded.root.getObjectByName("Root")!, bone = loaded.root.getObjectByName("Bone")!, mesh = loaded.root.getObjectByName("Crystal") as SkinnedMesh
    assert.ok(mesh.isSkinnedMesh); assert.equal(mesh.skeleton.bones.length, 1)
    loaded.update(object, 9); const pose = [...root.position.toArray(), ...bone.quaternion.toArray()]
    assert.equal(root.position.y, .5); assert.equal(Math.abs(bone.quaternion.y), 1)
    loaded.update(object, 18); assert.equal(root.position.y, 0)
    loaded.update(object, 9); assert.deepEqual([...root.position.toArray(), ...bone.quaternion.toArray()], pose)
    loaded.update(object, 9); assert.deepEqual([...root.position.toArray(), ...bone.quaternion.toArray()], pose)
    object.clip = 1; loaded.update(object, 3); assert.equal(mesh.morphTargetInfluences?.[0], 1)
    loaded.update(object, 6); assert.equal(mesh.morphTargetInfluences?.[0], 0)
    loaded.update(object, 3); assert.equal(mesh.morphTargetInfluences?.[0], 1)
    object.clip = 0; object.loop = true; loaded.update(object, 27); assert.equal(root.position.y, .5)
    let disposals = 0; mesh.geometry.addEventListener("dispose", () => disposals++)
    loaded.dispose(); loaded.dispose(); assert.equal(disposals, 1)
  } finally { loaded?.dispose(); globalThis.fetch = original }
})

test("un modelo cancelado antes de mostrarse no conserva recursos ni acepta una URL remota", async () => {
  await assert.rejects(loadSceneModel("https://example.test/a.glb", new AbortController().signal), /dirección/)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(modelFixture())
  try { const abort = new AbortController(); abort.abort(); await assert.rejects(loadSceneModel(`/api/visual/models/${"a".repeat(64)}.glb`, abort.signal), { name: "AbortError" }) }
  finally { globalThis.fetch = original }
})
