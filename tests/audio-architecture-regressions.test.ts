import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(path, "utf8")

test("los laboratorios A/B no vuelven a sumar overlays físicos post-master", () => {
  const winter = read("client/src/audio/ViolinWinterStressRunner.ts")
  const matrix = read("client/src/audio/HybridAbCalibrationRunner.ts")
  for (const source of [winter, matrix]) {
    assert.doesNotMatch(source, /scheduleHybridPhysicalOverlay/)
    assert.doesNotMatch(source, /physicalBus/)
    assert.match(source, /hybridMode: "none"/)
    assert.match(source, /hybridMode: "quality"/)
  }
})

test("los modelos físicos principales no usan Math.random", () => {
  for (const path of [
    "client/src/audio/PhysicalBowedStringOverlay.ts",
    "client/src/audio/PhysicalAirColumnOverlay.ts",
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /Math\.random/)
    assert.match(source, /createDeterministicNoiseBuffer/)
  }
})

test("el cache no conserva aliases mutables de manifests", () => {
  const source = read("client/src/audio/AudioResourceCache.ts")
  assert.match(source, /tloque-audio-v2/)
  assert.match(source, /\/api\/audio\/sample-packs\/modules\//)
  assert.match(source, /cache: "no-store"/)
  assert.match(source, /isMutableSamplePackAlias/)
})

test("la matriz de certificación exige banco nativo real", () => {
  const source = read("client/src/audio/HybridAbCalibrationRunner.ts")
  assert.match(source, /preflightNativeSamplePacks/)
  assert.match(source, /No se usará síntesis fallback/)
})
