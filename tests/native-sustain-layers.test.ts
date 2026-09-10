import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { selectNativeSampleVelocityBlend, selectNativeSampleVelocityTrajectory, NATIVE_SAMPLE_LAYER_MAX_POINTS, NATIVE_SAMPLE_LAYER_MAX_SOURCES } from "../client/src/audio/NativeSampleVelocityBlend"
import { buildNativeSampleScorePlan, nativeSampleVoiceEnvelope } from "../client/src/audio/NativeSampleScorePlan"
import { buildNativeProgressivePreloadPlan } from "../client/src/audio/NativeProgressivePreload"
import type { InstrumentManifest } from "../shared/instrument-manifest"
import { SUSTAIN_LAYER_PACK as pack, SUSTAIN_LAYER_SCORE, sustainLayerRecipe } from "./fixtures/native-sustain-layers"

test("una trayectoria recorre capas físicas con potencia unitaria y amplitud independiente", () => {
  const velocities = Float32Array.from([8, 30, 64, 95, 120, 64, 8])
  const voices = selectNativeSampleVelocityTrajectory(pack, "normal", 69, velocities, 0, { amplitudeVelocity: 80 })
  assert.equal(voices.length, 3)
  assert.ok(voices.every(voice => voice.gain === 80 / 127 && voice.layerGainCurve?.length === velocities.length))
  for (let i = 0; i < velocities.length; i++) {
    const power = voices.reduce((sum, voice) => sum + voice.layerGainCurve![i] ** 2, 0)
    assert.ok(Math.abs(power - 1) < 1e-6, `power at ${i}: ${power}`)
    const reference = selectNativeSampleVelocityBlend(pack, "normal", 69, velocities[i], 0, { amplitudeVelocity: 80 })
    for (const voice of voices) {
      const expected = reference.find(item => item.zone.id === voice.zone.id)?.gain ?? 0
      assert.ok(Math.abs(voice.gain * voice.layerGainCurve![i] - expected) < 1e-7)
    }
  }
  assert.equal(voices.find(voice => voice.zone.velocityLayer === 2)!.layerGainCurve![0], 0)
  assert.equal(voices.find(voice => voice.zone.velocityLayer === 2)!.layerGainCurve![4], 1)
  assert.deepEqual(voices, selectNativeSampleVelocityTrajectory(pack, "normal", 69, velocities, 0, { amplitudeVelocity: 80 }))
})

test("una capa y una expresión constante mantienen exactamente la ruta estática", () => {
  for (const testPack of [pack, { ...pack, zones: [{ ...pack.zones[0], hiVelocity: 127 }] }]) {
    const velocities = Float32Array.from(testPack === pack ? [65, 65, 65] : [10, 65, 120])
    const voices = selectNativeSampleVelocityTrajectory(testPack, "normal", 69, velocities, 0)
    assert.deepEqual(voices, selectNativeSampleVelocityBlend(testPack, "normal", 69, velocities[0], 0))
    assert.ok(voices.every(voice => !voice.layerGainCurve))
  }
})

test("ampeg_dynamic=0 tampoco multiplica velocity dentro de una trayectoria", () => {
  const physicalGain = { ...pack, zones: pack.zones.map(zone => ({ ...zone, amplitudeDynamic: false, gainDb: -6 })) }
  const voices = selectNativeSampleVelocityTrajectory(physicalGain, "normal", 69, Float32Array.from([8, 64, 120]), 0, { amplitudeVelocity: 5 })
  assert.ok(voices.every(voice => voice.gain === 10 ** (-6 / 20)))
})

test("RR, raíz de violín, articulación, micrófono y color no cambian a mitad de nota", () => {
  const zones = pack.zones.flatMap(zone => [
    { ...zone, id: `${zone.id}-rr1`, roundRobin: 1 },
    { ...zone, id: `${zone.id}-rr0`, roundRobin: 0 },
    { ...zone, id: `${zone.id}-neighbor`, rootMidi: 73, roundRobin: 1 },
    { ...zone, id: `${zone.id}-room`, micPosition: "room" as const, roundRobin: 1 },
    { ...zone, id: `${zone.id}-vibrato`, vibratoColour: "vibrato" as const, roundRobin: 1 },
    { ...zone, id: `${zone.id}-mute`, mute: "mute" as const, roundRobin: 1 },
    { ...zone, id: `${zone.id}-short`, articulation: "spiccato" as const, roundRobin: 1 },
  ])
  const voices = selectNativeSampleVelocityTrajectory({ ...pack, zones }, "normal", 70, Float32Array.from([10, 64, 120]), 1)
  assert.equal(voices.length, 3)
  assert.ok(voices.every(voice => voice.zone.id.endsWith("-rr1") && voice.playbackRate === 2 ** (1 / 12)))
})

test("no inventa transiciones o releases ni acepta curvas ilimitadas o no finitas", () => {
  const curve = Float32Array.from([10, 120])
  assert.deepEqual(selectNativeSampleVelocityTrajectory(pack, "legato", 69, curve, 0, { trigger: "legato-transition", transitionFromMidi: 67, transitionToMidi: 69 }), [])
  assert.deepEqual(selectNativeSampleVelocityTrajectory(pack, "normal", 69, curve, 0, { trigger: "release" }), [])
  for (const invalid of [new Float32Array(1), new Float32Array(NATIVE_SAMPLE_LAYER_MAX_POINTS + 1), Float32Array.from([10, NaN])]) {
    assert.throws(() => selectNativeSampleVelocityTrajectory(pack, "normal", 69, invalid, 0), /Curva de capas/)
  }
  const dense = { ...pack, zones: Array.from({ length: 10 }, (_, layer) => ({ ...pack.zones[0], id: `dense-${layer}`, velocityLayer: layer, loVelocity: layer * 12, hiVelocity: layer * 12 + 11 })) }
  assert.throws(() => selectNativeSampleVelocityTrajectory(dense, "normal", 69, Float32Array.from({ length: 128 }, (_, i) => i), 0), new RegExp(`supera ${NATIVE_SAMPLE_LAYER_MAX_SOURCES} fuentes`))
})

test("la obra precarga todas las capas visitadas y comparte envolvente live/WAV", () => {
  const recipe = sustainLayerRecipe()
  const plan = buildNativeSampleScorePlan(recipe, pack)
  assert.equal(plan.voices.length, 3)
  assert.equal(plan.zones.length, 3)
  assert.equal(new Set(plan.voices.map(voice => voice.startSeconds)).size, 1)
  assert.ok(plan.voices.every(voice => voice.layerGainCurve && voice.layerGainCurve.length <= NATIVE_SAMPLE_LAYER_MAX_POINTS))
  const forte = plan.voices.find(voice => voice.zoneId === "layer-2")!
  assert.equal(forte.layerGainCurve![0], 0)
  assert.ok(forte.layerGainCurve!.at(-1)! > 0.3)
  const preload = buildNativeProgressivePreloadPlan(plan)
  assert.equal(preload.length, 3)
  assert.ok(preload.every(item => item.firstUseSeconds === plan.voices[0].startSeconds && item.preloadAtSeconds === 0))
  assert.deepEqual(plan, buildNativeSampleScorePlan(recipe, pack))
  for (const voice of plan.voices) {
    const envelope = nativeSampleVoiceEnvelope(voice)
    assert.equal(envelope.layerGainCurve, voice.layerGainCurve)
    assert.equal(envelope.expression, voice.expression)
    assert.equal(envelope.dynamics, voice.dynamics)
  }
  for (const file of ["NativeSampleScoreEngine.ts", "NativeSampleScoreExporter.ts"]) {
    assert.match(readFileSync(`client/src/audio/${file}`, "utf8"), /nativeSampleVoiceEnvelope\(voice\)/)
  }
})

test("un crescendo interrumpido cambia de dirección sin congelar el tramo intermedio", () => {
  const source = SUSTAIN_LAYER_SCORE.replace("end", "control 1:3 expression=0.05 ramp=1\nend")
  const plan = buildNativeSampleScorePlan(sustainLayerRecipe(source), pack)
  const soft = plan.voices.find(voice => voice.zoneId === "layer-0")!
  const curve = soft.layerGainCurve!
  assert.ok(curve[0] > curve[Math.round(curve.length * 0.5)] + 0.2)
  assert.ok(Math.abs(curve[0] - curve.at(-1)!) < 1e-6)
})

test("el release grabado sigue el color final del crescendo, no el del ataque", () => {
  const manifest: InstrumentManifest = {
    version: 1, id: pack.instrumentManifestId, family: "strings", name: "Release fixture",
    instruments: ["strings.violin"], basePrograms: [40], capabilities: ["velocity-layers", "release-samples"],
    articulations: [{ articulation: "normal", velocityLayers: 3, releaseSamples: true }],
  }
  const withReleases = { ...pack, zones: [...pack.zones, ...pack.zones.map(zone => ({ ...zone, id: `${zone.id}-release`, trigger: "release" as const }))] }
  const plan = buildNativeSampleScorePlan(sustainLayerRecipe(SUSTAIN_LAYER_SCORE.replace("velocity=0.42", "velocity=0.6")), withReleases, { manifests: [manifest] })
  assert.equal(plan.auxiliaryVoices.length, 1)
  assert.equal(plan.auxiliaryVoices[0].zoneId, "layer-2-release")
  assert.ok(plan.voices[0].layerVelocity < pack.zones[2].loVelocity)
  assert.equal(plan.auxiliaryVoices[0].velocity, plan.voices[0].velocity, "authored amplitude is not counted again")
})

test("humanize mueve el ataque pero no desplaza la automatización global", () => {
  const source = SUSTAIN_LAYER_SCORE.replace("humanize 0", "humanize 0.8")
    .replace("1:1 A4 4", "1:2 A4 3")
    .replace("control 1:1.5 expression=1 ramp=2.5", "control 1:2.5 expression=1 ramp=1.5")
  const plan = buildNativeSampleScorePlan(sustainLayerRecipe(source), pack)
  const voice = plan.voices.find(voice => voice.layerGainCurve && voice.layerGainCurve[0] > 0)!
  assert.notEqual(voice.startSeconds, 1)
  const curve = voice.layerGainCurve!
  const firstChange = curve.findIndex(value => Math.abs(value - curve[0]) > 1e-5)
  const firstChangeTime = voice.startSeconds + firstChange * voice.durationSeconds / (curve.length - 1)
  assert.ok(firstChangeTime >= 1.5 && firstChangeTime < 1.54, `control moved to ${firstChangeTime}`)
})

test("notas cortas, pizzicato y ataques de piano no cambian de capa durante el decay", () => {
  const cases = [
    SUSTAIN_LAYER_SCORE.replace("A4 4", "A4 0.2"),
    SUSTAIN_LAYER_SCORE.replace("articulation=normal", "articulation=pizzicato"),
    SUSTAIN_LAYER_SCORE.replace("instrument=strings.violin", "instrument=piano.grand"),
    SUSTAIN_LAYER_SCORE.replace("control 1:1.5 expression=1 ramp=2.5", "control 1:1.5 brightness=1 ramp=2.5"),
  ]
  for (const source of cases) {
    const plan = buildNativeSampleScorePlan(sustainLayerRecipe(source), pack)
    assert.ok(plan.voices.length > 0)
    assert.ok(plan.voices.every(voice => !voice.layerGainCurve))
  }
})
