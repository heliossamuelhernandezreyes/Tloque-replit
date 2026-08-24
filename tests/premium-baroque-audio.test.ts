import test from "node:test"
import assert from "node:assert/strict"
import { INSTRUMENT_MANIFEST_REGISTRY } from "../shared/instrument-manifest"
import { CURATED_SAMPLE_PACKS } from "../shared/curated-sample-packs"
import { CURATED_RAW_WAV_PACKS, VCSL_ITALIAN_HARPSICHORD_PACK } from "../shared/curated-raw-wav-packs"

const BAROQUE_EXPECTED = new Map([
  ["strings.violin", "vsco2-ce-solo-violin"],
  ["strings.viola", "vsco2-ce-viola-section"],
  ["strings.cello", "vsco2-ce-cello-section"],
  ["keys.harpsichord", "vcsl-italian-harpsichord-stop1"],
])

const CURATED_MODULES = new Set([
  ...CURATED_SAMPLE_PACKS.map(pack => pack.moduleId),
  ...CURATED_RAW_WAV_PACKS.map(pack => pack.moduleId),
])

test("native-auto tiene cobertura premium completa para el conjunto barroco", () => {
  for (const [instrumentId, expectedModule] of BAROQUE_EXPECTED) {
    const manifest = INSTRUMENT_MANIFEST_REGISTRY.find(item =>
      item.id !== "gm-orchestral-strings" && item.instruments.includes(instrumentId),
    )
    assert.ok(manifest, `Falta manifest nativo para ${instrumentId}`)
    assert.equal(manifest.id, expectedModule, `${instrumentId} debe resolver al módulo premium esperado`)
    assert.ok(CURATED_MODULES.has(expectedModule), `${expectedModule} debe tener una fuente curada instalable`)
  }
})

test("el clave italiano premium conserva ataques y releases físicos", () => {
  assert.equal(VCSL_ITALIAN_HARPSICHORD_PACK.instrumentId, "keys.harpsichord")
  assert.equal(VCSL_ITALIAN_HARPSICHORD_PACK.manifestId, "vcsl-italian-harpsichord-stop1")
  assert.equal(VCSL_ITALIAN_HARPSICHORD_PACK.sourceKind, "raw-wav-static")
  assert.ok((VCSL_ITALIAN_HARPSICHORD_PACK.rawWavStaticPaths?.length ?? 0) >= 60)
  assert.ok(VCSL_ITALIAN_HARPSICHORD_PACK.tags.includes("release-samples"))
})
