import test from "node:test"
import assert from "node:assert/strict"
import { createSceneContent, createShape, contentDuration, sceneContentSchema } from "../shared/scene-content"
import { inspectGlb } from "../shared/validate-glb"
import { modelFixture } from "./fixtures/animated-model"
import { cardSceneFromFx, createCardScene, resizeCardDuration } from "../shared/card-scene"
import { validateCard } from "../server/cards"
import { validateFrame } from "../server/frames"
import { createFrameScene, packageFrameScene } from "../shared/frame-scene"
import { sceneKey } from "../client/src/visual/scenes"
import { Scene, Group, Mesh } from "three"
import { createSceneObjects } from "../client/src/visual/scene-objects"
import { createSceneWeather } from "../client/src/visual/scene-weather"

test("GLB conserva clips largos, esqueleto y morph targets sin recortar", () => {
  const metadata = inspectGlb(modelFixture())
  assert.deepEqual(metadata.clips, [{ name: "Vuelo completo", duration: 18 }, { name: "Cristal crece", duration: 6 }])
  assert.equal(metadata.triangles, 4)
})

test("GLB rechaza recursos externos, ciclos, asignaciones enormes y compresión sin decodificador", () => {
  for (const mutate of [
    (d: any) => { d.buffers[0].uri = "https://example.test/remote.bin" },
    (d: any) => { d.nodes[2].children = [0] },
    (d: any) => { d.accessors[0].count = 1e9 },
    (d: any) => { d.accessors[0].bufferView = 2000 },
    (d: any) => { d.bufferViews[0].byteOffset = 1e9 },
    (d: any) => { d.extensionsRequired = ["KHR_draco_mesh_compression"] },
    (d: any) => { d.materials[0].extensions = { UNKNOWN_material_script: { script: "external" } } },
    (d: any) => { d.nodes[0].children.push(1) },
    (d: any) => { d.images = [{ mimeType: "image/png", bufferView: 0 }] },
    (d: any) => { d.animations[0].channels[0].target.node = 1000 },
  ]) assert.throws(() => inspectGlb(modelFixture(mutate)))
  const truncated = modelFixture().subarray(0, 50); assert.throws(() => inspectGlb(truncated))
  const nan = modelFixture(), jsonLength = nan.readUInt32LE(12); nan.writeFloatLE(NaN, 28 + jsonLength)
  assert.throws(() => inspectGlb(nan), /coordenadas/)
})

test("tarjetas sin fondo y marcos conservan objetos, vidrio y efectos al guardar", () => {
  const content = createSceneContent(); content.objects.push(createShape("crystal", "gem")); content.glass.enabled = true; content.effect.type = "fire"
  const scene = createCardScene(); scene.content = content
  const result = validateCard({ name: "Cristal", fx: { scene } })
  assert.ok(result.ok); assert.deepEqual(result.card.fx.scene.content, content)
  const frame = createFrameScene(); frame.content = content
  const saved = validateFrame({ name: "Corona", pkg: packageFrameScene(frame, "Corona", "both") })
  assert.ok(saved.ok); assert.deepEqual(saved.frame.pkg.scene.content, content)
  assert.equal(validateCard({ name: "vacío", fx: { scene: createCardScene() } }).ok, false)
  const hostile = structuredClone(scene); (hostile.content!.objects[0] as any).script = "alert(1)"
  assert.equal(validateCard({ name: "mal", fx: { scene: hostile } }).ok, false)
})

test("recetas limitan geometría y sólo admiten referencias persistentes locales", () => {
  const content = createSceneContent(); const shape = createShape("box", "a")
  content.objects = [shape, shape]; assert.equal(sceneContentSchema.safeParse(content).success, false)
  content.objects = [{ ...shape, kind: "model", source: "blob:local" } as any]
  assert.equal(sceneContentSchema.safeParse(content).success, false)
  content.objects = Array.from({ length: 17 }, (_, i) => createShape("box", String(i)))
  assert.equal(sceneContentSchema.safeParse(content).success, false)
})

test("movimiento y vidrio no reconstruyen el renderizador ni pierden materiales al editar", () => {
  const content = createSceneContent(); content.objects = [createShape("crystal", "gem")]
  const cardScene = createCardScene(); cardScene.content = content
  const originalKey = sceneKey({ kind: "portal", cardScene })
  const world = new Scene(), frame = new Group(), objects = createSceneObjects(world, frame, 2, 3)
  objects.update(content, 2)
  const mesh = world.getObjectByName("tloque-object:gem")!.children[0] as Mesh
  let disposed = 0; mesh.geometry.addEventListener("dispose", () => disposed++)
  content.objects[0].position.x = .5; content.objects[0].motion = "spin"; content.glass.enabled = true
  objects.update(content, 4); const matrix = mesh.parent!.rotation.toArray()
  objects.update(content, 4); assert.deepEqual(mesh.parent!.rotation.toArray(), matrix)
  assert.equal(world.getObjectByName("tloque-object:gem")!.children[0], mesh)
  assert.equal(sceneKey({ kind: "portal", cardScene }), originalKey)
  objects.dispose(); objects.dispose(); assert.equal(disposed, 1); assert.equal(world.children.length, 0)
})

test("el clima 3D usa tiempo absoluto, una sola geometría y se libera", () => {
  const world = new Scene(), weather = createSceneWeather(world), effect = createSceneContent().effect
  effect.type = "rain"; weather.update(effect, 4)
  const points = world.children[0] as any
  assert.equal(points.material.uniforms.uTime.value, 4)
  weather.update(effect, 90); weather.update(effect, 4)
  assert.equal(points.material.uniforms.uTime.value, 4)
  assert.equal(points.geometry.attributes.position.count, 160)
  effect.type = "none"; weather.update(effect, 5); assert.equal(points.visible, false)
  weather.dispose(); assert.equal(world.children.length, 0)
})

test("migrar efectos antiguos no muta la tarjeta ni reactiva Canvas", () => {
  const fx = { layerFx: { front: { effect: "rainGlass", intensity: .6 } } }, before = JSON.stringify(fx)
  const scene = cardSceneFromFx(fx)
  assert.equal(scene.content?.effect.type, "rain"); assert.equal(scene.content?.glass.enabled, true)
  assert.equal(JSON.stringify(fx), before)
})

test("las secuencias largas conservan el final y el tiempo ralentizado completo", () => {
  const scene = resizeCardDuration(createCardScene(), 1200)
  assert.equal(scene.layers.front.keys.at(-1)?.time, 1200)
  const content = createSceneContent()
  content.objects = [{ id: "glb", kind: "model", name: "Largo", placement: "scene", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, motion: "still", speed: .1, source: `/api/visual/models/${"a".repeat(64)}.glb`, clips: [{ name: "Largo", duration: 120 }], clip: 0, loop: false }]
  assert.equal(contentDuration(content), 1200)
})
