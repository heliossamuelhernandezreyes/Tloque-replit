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

test("Winter mantiene fuentes nativas estrictas durante todo el render", () => {
  const runner = read("client/src/audio/ViolinWinterStressRunner.ts")
  const exporter = read("client/src/audio/NativeSampleScoreExporter.ts")
  assert.match(runner, /strictNativeSources: true/)
  assert.match(exporter, /strictNativeSources\?: boolean/)
  assert.match(exporter, /if \(options\.strictNativeSources\) throw/)
})

test("los modelos físicos principales usan ruido determinista compartido y nunca Math.random", () => {
  for (const path of [
    "client/src/audio/PhysicalBowedStringOverlay.ts",
    "client/src/audio/PhysicalAirColumnOverlay.ts",
    "client/src/audio/PhysicalReedModel.ts",
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /Math\.random/)
    assert.match(source, /sharedDeterministicNoiseBuffer/)
    assert.match(source, /deterministicNoiseOffset/)
  }
})

test("el cache no conserva aliases mutables de manifests", () => {
  const source = read("client/src/audio/AudioResourceCache.ts")
  assert.match(source, /tloque-audio-v2/)
  assert.match(source, /\/api\/audio\/sample-packs\/modules\//)
  assert.match(source, /cache: "no-store"/)
  assert.match(source, /isMutableSamplePackAlias/)
  assert.match(source, /cacheNativeSamplePack/)
  assert.match(source, /zone\.sampleUrl/)
  assert.match(source, /sha256/)
  assert.match(source, /OFFLINE_MODULE_PREFIX/)
})

test("service worker conserva la fonoteca descargada entre despliegues", () => {
  const source = read("client/public/sw.js")
  assert.match(source, /AUDIO_CACHE = "tloque-audio-v2"/)
  assert.match(source, /new Set\(\[SHELL_CACHE, RUNTIME_CACHE, AUDIO_CACHE\]\)/)
})

test("entrega de objetos soporta caché condicional y peticiones Range", () => {
  const source = read("server/audioUploads.ts")
  assert.match(source, /Accept-Ranges", "bytes"/)
  assert.match(source, /Content-Range/)
  assert.match(source, /status\(416\)\.end\(\)/)
  assert.match(source, /status\(206\)/)
  assert.match(source, /If-None-Match/)
})

test("hay un único instalador canónico e incluye todas las fuentes PCM aprobadas", () => {
  const canonical = read("server/nativeSamplePackRoutes.ts")
  const legacy = read("server/audioUploads.ts")
  assert.match(canonical, /CURATED_INSTALLABLE_SAMPLE_PACKS/)
  assert.equal((canonical.match(/sample-pack-catalog\/:sourceId\/install/g) ?? []).length, 1)
  assert.equal((legacy.match(/sample-pack-catalog\/:sourceId\/install/g) ?? []).length, 0)
})

test("el lector puede arrancar Music Brain sin soundtrack y muestra el tier real", () => {
  const menu = read("client/src/components/ReaderAudioMenu.tsx")
  const reader = read("client/src/pages/reader.tsx")
  assert.match(menu, /if \(!musicBrain\) return null/)
  assert.match(menu, /title: "Music Brain"/)
  assert.match(menu, /playbackTier/)
  assert.match(menu, /cacheMusicBrainScoreResources/)
  assert.match(reader, /soundtrack \|\| experienceData\?\.musicBrain \|\| book\?\.spotifyLink/)
  assert.match(reader, /music\.loadAdaptiveLayers/)
})

test("scoreId y layerIds resuelven stems publicados y el motor corrige drift", () => {
  const server = read("server/narrative.ts")
  const hybrid = read("client/src/audio/HybridMusicEngine.ts")
  const stems = read("client/src/audio/AdaptiveLayerMusicEngine.ts")
  assert.match(server, /readerAudioLayers/)
  assert.match(server, /eq\(audioAssets\.sourceType, "stream"\)/)
  assert.match(hybrid, /adaptiveLayersForRegion/)
  assert.match(hybrid, /sourceType: "adaptive"/)
  assert.match(stems, /Promise\.allSettled/)
  assert.match(stems, /currentTime - leader\.currentTime/)
  assert.match(stems, /crossfading/)
})

test("cada exportación pasa por el medidor de master antes de descargar", () => {
  const exporter = read("client/src/audio/ScoreExporter.ts")
  const sampled = read("client/src/audio/ScoreSampledExporter.ts")
  const admin = read("client/src/pages/AudioCatalogAdmin.tsx")
  assert.match(exporter, /PcmAnalysisAccumulator/)
  assert.match(sampled, /analyzeAudioBuffer/)
  assert.match(admin, /assessAudioMasteringSafety/)
  assert.match(admin, /Master rechazado por control de calidad/)
})

test("la matriz de certificación exige banco nativo real", () => {
  const source = read("client/src/audio/HybridAbCalibrationRunner.ts")
  assert.match(source, /preflightNativeSamplePacks/)
  assert.match(source, /No se usará síntesis fallback/)
})

test("native-auto no depende del orden accidental del registry", () => {
  const source = read("client/src/audio/NativeAutoModule.ts")
  assert.match(source, /nativeModuleRank/)
  assert.match(source, /nativeModulesForInstrument/)
  assert.match(source, /localeCompare/)
  assert.doesNotMatch(source, /INSTRUMENT_MANIFEST_REGISTRY\.find\(/)
})

test("el exportador contabiliza samples decodificados además del buffer final", () => {
  const source = read("client/src/audio/NativeSampleScoreExporter.ts")
  assert.match(source, /MAX_OFFLINE_TOTAL_FLOAT_BYTES/)
  assert.match(source, /decodedFloatBytes/)
  assert.match(source, /floatBytes \+ decodedFloatBytes\(decodedByUrl\)/)
})
