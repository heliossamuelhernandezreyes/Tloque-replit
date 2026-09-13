import test from "node:test"
import assert from "node:assert/strict"
import { applyCardMotion, CARD_LAYERS, CARD_MOTION_PRESETS, cardLayerStyle, cardSceneSchema, createCardScene, evaluateCardLayer, evaluateCardOffset, readCardScene, resizeCardDuration, setCardKey } from "../shared/card-scene"
import { easeMotion, MOTION_EASES } from "../shared/motion-easing"
import { applyFrameMotion, FRAME_MOTION_PRESETS } from "../shared/frame-motion-presets"
import { createFrameScene, evaluateFrameScene, frameSceneSchema } from "../shared/frame-scene"
import { sanitizeCardFx, validateCard } from "../server/cards"
import { sceneKey } from "../client/src/visual/scenes"

test("las seis curvas son deterministas, acotadas y sin sobrepaso", () => {
  for (const name of Object.keys(MOTION_EASES) as (keyof typeof MOTION_EASES)[]) {
    assert.equal(easeMotion(0, name), 0); assert.equal(easeMotion(1, name), 1)
    let last = 0
    for (let i = 0; i <= 100; i++) { const v = easeMotion(i / 100, name); assert.ok(v >= last - 1e-12 && v <= 1); last = v }
  }
  assert.equal(easeMotion(.99, "hold"), 0)
  assert.ok(easeMotion(.1, "cinematic") < easeMotion(.1, "smooth"))
})
test("presets de tarjeta conservan el encuadre, cierran la secuencia y se pueden buscar sin deriva", () => {
  const base = createCardScene(); base.layers.mid.transform.x = .15
  for (const preset of Object.keys(CARD_MOTION_PRESETS) as (keyof typeof CARD_MOTION_PRESETS)[]) {
    const scene = applyCardMotion(base, preset)
    assert.equal(cardSceneSchema.safeParse(scene).success, true)
    for (const layer of CARD_LAYERS) {
      assert.deepEqual(scene.layers[layer].transform, base.layers[layer].transform)
      assert.deepEqual(evaluateCardLayer(scene, layer, scene.duration), base.layers[layer].transform)
      const pose = evaluateCardLayer(scene, layer, 2.35)
      evaluateCardLayer(scene, layer, 5.1)
      assert.deepEqual(evaluateCardLayer(scene, layer, 2.35), pose)
      assert.deepEqual(evaluateCardLayer(scene, layer, 2.35, false), base.layers[layer].transform)
    }
  }
  assert.equal(base.layers.mid.keys.length, 2, "presets do not mutate source")
})
test("claves exactas, opacidad cero y duración escalada sin perder posiciones relativas", () => {
  const scene = applyCardMotion(createCardScene(), "reveal")
  assert.equal(evaluateCardLayer(scene, "mid", 0).opacity, 0)
  assert.deepEqual(evaluateCardLayer(scene, "mid", Number.NaN), evaluateCardLayer(scene, "mid", 0))
  assert.deepEqual(evaluateCardLayer(scene, "mid", 99), evaluateCardLayer(scene, "mid", 8))
  const resized = resizeCardDuration(scene, 11)
  const scaledPose = evaluateCardLayer(resized, "front", 5.5), originalPose = evaluateCardLayer(scene, "front", 4)
  for (const key of Object.keys(scaledPose) as (keyof typeof scaledPose)[]) assert.ok(Math.abs(scaledPose[key] - originalPose[key]) < 1e-12)
  const next = setCardKey(scene, "front", { ...scene.layers.front.keys[2], time: 4.5, x: .4 })
  assert.equal(evaluateCardLayer(next, "front", 4.5).x, .4)
  assert.equal(next.layers.front.keys.length, scene.layers.front.keys.length + 1)
})
test("recetas inválidas nunca se silencian al guardar: límites, claves, versión, scripts y recursos", () => {
  const mutations = [
    (s: any) => { s.version = "future" }, (s: any) => { s.shader = "void main(){}" },
    (s: any) => { s.layers.mid.transform.scale = 99 }, (s: any) => { s.layers.back.depth = Infinity },
    (s: any) => { s.layers.front.keys[0].time = 1 }, (s: any) => { s.layers.front.keys[1].time = 7 },
    (s: any) => { s.layers.front.keys.reverse() }, (s: any) => { s.layers.front.keys[0].ease = "spring" },
    (s: any) => { s.layers.front.keys = Array(200).fill(s.layers.front.keys[0]) },
    (s: any) => { s.finish.strength = 1 }, (s: any) => { s.layers.front.url = "https://untrusted.test/model.glb" },
  ]
  for (const mutate of mutations) {
    const scene = createCardScene(); mutate(scene)
    assert.equal(readCardScene(scene), null)
    assert.equal(validateCard({ name: "Escena", fx: { layers: { back: "data:image/png;base64,AAAA" }, scene } }).ok, false)
  }
})
test("una capa base invisible conserva los valores editables de su clave", () => {
  const scene = applyCardMotion(createCardScene(), "reveal")
  scene.layers.front.transform.opacity = 0
  assert.equal(evaluateCardLayer(scene, "front", 0).opacity, 0)
  assert.equal(evaluateCardOffset(scene, "front", 0).opacity, 0)
  assert.equal(evaluateCardOffset(scene, "front", 8).opacity, 1)
})
test("servidor conserva escenas y derechos del marco; las tarjetas clásicas no se convierten", () => {
  const scene = applyCardMotion(createCardScene(), "drift")
  const input = { name: "Portal", fx: { layers: { back: "data:image/png;base64,AAAA", front: "data:image/webp;base64,AAAA" }, frameId: 7, scene } }
  const result = validateCard(input)
  assert.equal(result.ok, true)
  if (result.ok) { assert.deepEqual(result.card.fx.scene, scene); assert.equal(result.card.fx.frameId, 7); assert.equal(result.card.fx.layers.mid, "") }
  assert.equal("scene" in sanitizeCardFx({}), false)
  assert.equal(cardLayerStyle(scene, "mid").opacity, 1)
})
test("editar composición, profundidad, acabados o claves no reconstruye la GPU", () => {
  const scene = createCardScene(), options = { kind: "portal" as const, images: ["back", "", "front"], cardScene: scene }
  const key = sceneKey(options)
  const changed = applyCardMotion(scene, "reveal"); changed.layers.front.depth = .8; changed.layers.mid.transform.x = .2; changed.finish.type = "prismatic"
  assert.equal(sceneKey({ ...options, cardScene: changed }), key)
  assert.notEqual(sceneKey({ ...options, images: ["back", "front", ""] }), key)
  assert.notEqual(sceneKey({ ...options, cardScene: undefined }), key)
})
test("nuevas secuencias de marcos preservan el objeto y son evaluables con curvas cinematográficas", () => {
  const base = createFrameScene("bloom")
  for (const preset of Object.keys(FRAME_MOTION_PRESETS) as (keyof typeof FRAME_MOTION_PRESETS)[]) {
    const scene = applyFrameMotion(base, preset)
    assert.equal(frameSceneSchema.safeParse(scene).success, true)
    assert.deepEqual(scene.material, base.material); assert.deepEqual(scene.geometry, base.geometry)
    assert.equal(evaluateFrameScene(scene, 8).assembly, 0)
    assert.equal(evaluateFrameScene(scene, 8).aperture, 1)
  }
  assert.equal(base.animation.tracks.orbit[1].ease, "smooth")
})
