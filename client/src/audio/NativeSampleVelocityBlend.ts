import type { TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueSamplePack } from "@shared/native-sample-pack"
import { selectNativeSampleZone, type NativeSampleSelection, type NativeSampleTimbreRequest } from "./NativeSamplePackEngine"

export interface WeightedNativeSampleSelection extends NativeSampleSelection {
  weight: number
}

function zoneColour(zone: TloqueSamplePack["zones"][number]) {
  return zone.vibratoColour ?? (zone.vibrato === true ? "vibrato" : "none")
}

function noteDistance(zone: TloqueSamplePack["zones"][number], note: number) {
  if (note >= zone.loMidi && note <= zone.hiMidi) return 0
  return note < zone.loMidi ? zone.loMidi - note : note - zone.hiMidi
}

function semanticLayers(
  pack: TloqueSamplePack,
  articulation: TloqueArticulation,
  note: number,
  timbre: NativeSampleTimbreRequest,
) {
  const trigger = timbre.trigger ?? "attack"
  const requestedVibrato = timbre.vibratoColour ?? (timbre.vibrato === true ? "vibrato" : "none")
  const requestedMute = timbre.mute ?? "none"
  const requestedMic = timbre.micPosition ?? pack.defaultMicPosition ?? pack.micPositions?.[0] ?? "default"
  const compatible = (targetArticulation: TloqueArticulation) => pack.zones.filter(zone =>
    zone.articulation === targetArticulation
      && (zone.trigger ?? "attack") === trigger
      && zoneColour(zone) === requestedVibrato
      && (zone.mute ?? "none") === requestedMute
      && (zone.micPosition ?? pack.defaultMicPosition ?? "default") === requestedMic
      && noteDistance(zone, note) <= 4,
  )
  const exact = compatible(articulation)
  const zones = exact.length || articulation === "normal" ? exact : compatible("normal")
  const byLayer = new Map<number, { lo: number; hi: number }>()
  for (const zone of zones) {
    const current = byLayer.get(zone.velocityLayer)
    if (!current) byLayer.set(zone.velocityLayer, { lo: zone.loVelocity, hi: zone.hiVelocity })
    else {
      current.lo = Math.min(current.lo, zone.loVelocity)
      current.hi = Math.max(current.hi, zone.hiVelocity)
    }
  }
  return [...byLayer.entries()]
    .map(([layer, range]) => ({ layer, ...range, center: (range.lo + range.hi) / 2 }))
    .sort((a, b) => a.center - b.center)
}

function rescaleGainForActualVelocity(selection: NativeSampleSelection, probeVelocity: number, actualVelocity: number) {
  const probe = Math.max(1, probeVelocity)
  return selection.gain * Math.max(0, actualVelocity) / probe
}

/**
 * Returns one or two physical velocity layers for an attack. Between recorded layer
 * centres Tloque uses an equal-power crossfade instead of abruptly switching sample
 * colour. Releases and true-legato transitions remain strictly single-layer events.
 */
export function selectNativeSampleVelocityBlend(
  pack: TloqueSamplePack,
  articulation: TloqueArticulation,
  note: number,
  midiVelocity: number,
  roundRobin: number,
  timbre: NativeSampleTimbreRequest = {},
): readonly WeightedNativeSampleSelection[] {
  if ((timbre.trigger ?? "attack") !== "attack") {
    const single = selectNativeSampleZone(pack, articulation, note, midiVelocity, roundRobin, timbre)
    return single ? [{ ...single, weight: 1 }] : []
  }

  const layers = semanticLayers(pack, articulation, note, timbre)
  if (layers.length <= 1) {
    const single = selectNativeSampleZone(pack, articulation, note, midiVelocity, roundRobin, timbre)
    return single ? [{ ...single, weight: 1 }] : []
  }

  const velocity = Math.max(0, Math.min(127, midiVelocity))
  let lower = layers[0]
  let upper = layers[layers.length - 1]
  for (let index = 0; index < layers.length - 1; index += 1) {
    if (velocity >= layers[index].center && velocity <= layers[index + 1].center) {
      lower = layers[index]
      upper = layers[index + 1]
      break
    }
  }
  if (velocity <= layers[0].center) lower = upper = layers[0]
  if (velocity >= layers[layers.length - 1].center) lower = upper = layers[layers.length - 1]

  const selectLayer = (layer: typeof lower) => {
    const probeVelocity = Math.max(layer.lo, Math.min(layer.hi, Math.round(layer.center)))
    const selection = selectNativeSampleZone(pack, articulation, note, probeVelocity, roundRobin, timbre)
    if (!selection) return null
    return {
      ...selection,
      gain: rescaleGainForActualVelocity(selection, probeVelocity, velocity),
    }
  }

  const lowSelection = selectLayer(lower)
  if (!lowSelection) return []
  if (lower.layer === upper.layer) return [{ ...lowSelection, weight: 1 }]
  const highSelection = selectLayer(upper)
  if (!highSelection) return [{ ...lowSelection, weight: 1 }]

  const span = Math.max(1, upper.center - lower.center)
  const t = Math.max(0, Math.min(1, (velocity - lower.center) / span))
  const lowWeight = Math.cos(t * Math.PI / 2)
  const highWeight = Math.sin(t * Math.PI / 2)
  return [
    { ...lowSelection, gain: lowSelection.gain * lowWeight, weight: lowWeight },
    { ...highSelection, gain: highSelection.gain * highWeight, weight: highWeight },
  ]
}
