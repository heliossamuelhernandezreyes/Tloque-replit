import test from "node:test"
import assert from "node:assert/strict"
import { Group, Mesh, Scene, Vector4, type WebGLRenderer } from "three"
import { createFrameScene, evaluateFrameScene, FRAME_CHANNELS, frameSceneSchema, packageFrameScene, readFrameScene, sceneFromLegacy } from "../shared/frame-scene"
import { validateFrame } from "../server/frames"
import { createVisualScene, sceneKey } from "../client/src/visual/scenes"

test("las tres direcciones de arte conservan escena y secuencia en JSON y servidor", () => {
  for (const style of ["astral", "reliquary", "bloom"] as const) for (const target of ["card", "profile", "both"] as const) {
    const scene = createFrameScene(style), pkg = packageFrameScene(scene, "Mi marco", target)
    const copy = JSON.parse(JSON.stringify(pkg)), result = validateFrame({ name: "Mi marco", target, pkg: copy, priceTinta: 24 })
    assert.ok(result.ok)
    assert.deepEqual(readFrameScene(result.frame.pkg), scene)
    assert.equal(result.frame.target, target)
    assert.equal(result.frame.schemaVersion, "2.0.0")
    assert.equal(result.frame.pkg.runtimePreset.target, target)
  }
})

test("se rechazan pistas arbitrarias, claves fuera de orden y cargas GPU excesivas", () => {
  for (const mutate of [
    (s: any) => { s.shader = "void main(){}" },
    (s: any) => { s.material.color = "url(https://example.test)" },
    (s: any) => { s.portal.particles = 1e6 },
    (s: any) => { s.geometry.ornaments = 200 },
    (s: any) => { s.geometry.depth = Infinity },
    (s: any) => { s.animation.duration = 1e6 },
    (s: any) => { s.animation.tracks.orbit[1].time = 0 },
    (s: any) => { s.animation.tracks.orbit[0].time = .1 },
    (s: any) => { s.animation.tracks.orbit[2].value = 500 },
    (s: any) => { s.animation.tracks.orbit[2].ease = "spring" },
    (s: any) => { s.animation.tracks.orbit.at(-1).time = 7 },
    (s: any) => { s.animation.tracks.audio = [{ time: 0, value: "javascript:x" }] },
  ]) {
    const scene = createFrameScene(); mutate(scene)
    assert.equal(frameSceneSchema.safeParse(scene).success, false)
    assert.equal(validateFrame({ name: "test", pkg: { schemaVersion: "2.0.0", runtimePreset: {}, scene } }).ok, false)
  }
  assert.equal(validateFrame({ name: "test", pkg: { renderer: "tloque-scene-v2", runtimePreset: {} } }).ok, false)
})

test("cambiar el tiempo nunca depende del historial ni produce sobreimpulso", () => {
  const scene = createFrameScene(), expected = evaluateFrameScene(scene, 2.6)
  assert.equal(expected.orbit, 32)
  for (const seconds of [7, .4, 2.6, 10, -30, NaN, Infinity]) {
    evaluateFrameScene(scene, seconds)
    assert.deepEqual(evaluateFrameScene(scene, 2.6), expected)
  }
  assert.deepEqual(evaluateFrameScene(scene, 100), evaluateFrameScene(scene, 8))
  for (let time = 0; time <= 8; time += .017) {
    const pose = evaluateFrameScene(scene, time)
    for (const [channel, value] of Object.entries(pose)) {
      const limits = FRAME_CHANNELS[channel as keyof typeof FRAME_CHANNELS]
      assert.ok(value >= limits.min && value <= limits.max && Number.isFinite(value))
    }
  }
})

test("convertir un clásico o editar una copia v2 no muta el original", () => {
  const legacy = { runtimePreset: { appearance: { material: { baseColor: "#112233", roughness: .4 }, ornaments: { shapes: [{ special: "preserve me" }] } } } }
  const original = JSON.stringify(legacy), scene = sceneFromLegacy(legacy)
  assert.equal(scene.material.color, "#112233")
  scene.material.color = "#ffffff"
  assert.equal(JSON.stringify(legacy), original)
  const pkg = packageFrameScene(scene, "a", "both"), copy = sceneFromLegacy(pkg)
  copy.animation.tracks.orbit[1].value = 10
  assert.equal(readFrameScene(pkg)!.animation.tracks.orbit[1].value, -24)
})

test("materiales y playhead se actualizan sin reconstruir GPU; topología sí invalida", () => {
  const scene = createFrameScene(), options = { kind: "frame" as const, frame: packageFrameScene(scene, "a", "both") }
  const original = sceneKey(options)
  const next = structuredClone(scene); next.material.color = "#000000"; next.animation.tracks.orbit[1].value = 5
  assert.equal(sceneKey({ ...options, frame: packageFrameScene(next, "b", "both"), transport: { current: { time: 4, mode: "inspection" } } }), original)
  next.geometry.ornaments++
  assert.notEqual(sceneKey({ ...options, frame: packageFrameScene(next, "b", "both") }), original)
})

class Recorder {
  scenes: Scene[] = []
  getViewport(out: Vector4) { return out.set(0, 0, 500, 600) }
  getScissor(out: Vector4) { return out.set(0, 0, 500, 600) }
  getScissorTest() { return true }
  setScissorTest() {} setRenderTarget() {} setViewport() {} setScissor() {} setClearColor() {} clear() {}
  render(scene: Scene) { this.scenes.push(scene) }
}

test("las escenas renderizan ambos formatos, mantienen el recorte y liberan GPU una sola vez", () => {
  for (const style of ["astral", "reliquary", "bloom"] as const) for (const shape of ["card", "profile"] as const) {
    const doc = createFrameScene(style), transport = { current: { time: 2.6, mode: "inspection" as const } }
    const options = { kind: "frame" as const, shape, frame: packageFrameScene(doc, "a", "both"), transport }
    const scene = createVisualScene(options, 1024), recorder = new Recorder()
    scene.update(20, .016, .8, { x: 0, y: 0 }, options)
    scene.render(recorder as unknown as WebGLRenderer)
    assert.equal(recorder.scenes.length, 2)
    const root = recorder.scenes[1].children.find(object => object instanceof Group)!
    const rotation = root.rotation.toArray()
    scene.update(10000, .016, .8, { x: 0, y: 0 }, options)
    assert.deepEqual(root.rotation.toArray(), rotation, "la pausa no usa el reloj global")
    const geometries = new Set<any>(), materials = new Set<any>()
    recorder.scenes.forEach(world => world.traverse(object => {
      if (!(object instanceof Mesh)) return
      geometries.add(object.geometry)
      for (const v of object.geometry.attributes.position.array) assert.ok(Number.isFinite(v))
      ;(Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m))
    }))
    assert.ok(geometries.size < 100)
    assert.ok(materials.size < 20)
    let disposed = 0
    for (const resource of [...geometries, ...materials]) resource.addEventListener("dispose", () => disposed++)
    scene.dispose(); scene.dispose()
    assert.equal(disposed, geometries.size + materials.size)
    assert.equal(scene.ready(), false)
  }
})
