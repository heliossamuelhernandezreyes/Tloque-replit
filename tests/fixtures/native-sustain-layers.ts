import { compileTloqueScore } from "../../shared/audio"
import { validateTloqueSamplePack } from "../../shared/native-sample-pack"

// Test-only metadata. Audio-render tests synthesize identifiable PCM locally;
// these fixtures are not recordings, production banks or listening evidence.
export const SUSTAIN_LAYER_SCORE = `TLOQUE_SCORE 2
title "Recorded-layer automation fixture"
tempo 60
meter 4/4
loop false
seed 109
humanize 0
quality studio
module vsco2-ce-solo-violin
track solo synth=pad instrument=strings.violin program=40 role=melody gain=0.30 pan=0 attack=0.02 release=0.2 expression=0.05 brightness=0.5 vibrato=0 timbre=natural
section phrase form=exposition bars=1 repeat=1 fade=0 tempo=60 rubato=0
use solo
1:1 A4 4 velocity=0.42 articulation=normal
control 1:1.5 expression=1 ramp=2.5
end`

export function sustainLayerRecipe(source = SUSTAIN_LAYER_SCORE) {
  const compiled = compileTloqueScore(source)
  if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join("\n"))
  if (compiled.recipe.version !== 2) throw new Error("Expected V2 fixture")
  return compiled.recipe
}

export const SUSTAIN_LAYER_PACK = validateTloqueSamplePack({
  version: 1,
  id: "sustain-layers-fixture",
  name: "Three dynamics fixture",
  instrumentManifestId: "vsco2-ce-solo-violin",
  license: "CC0-1.0",
  sourceName: "Tloque test fixture, not an acoustic recording",
  sourceUrl: "https://example.invalid",
  zones: [0, 1, 2].map(layer => ({
    id: `layer-${layer}`,
    articulation: "normal",
    sampleUrl: `/api/audio/sample-packs/test-layer-${layer}.wav`,
    rootMidi: 69, loMidi: 67, hiMidi: 71,
    loVelocity: layer * 43, hiVelocity: Math.min(127, layer * 43 + 42),
    velocityLayer: layer, roundRobin: 0, gainDb: 0, tuneCents: 0,
    amplitudeAttackSeconds: 0.01, amplitudeReleaseSeconds: 0.1,
    loopStartSeconds: 0.2, loopEndSeconds: 0.8,
  })),
})
