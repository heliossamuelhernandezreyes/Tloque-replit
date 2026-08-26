import type { TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueSamplePack, TloqueSampleZone } from "@shared/native-sample-pack"
import { selectNativeSampleZone, type NativeSampleSelection, type NativeSampleTimbreRequest } from "./NativeSamplePackEngine"

export interface WeightedNativeSampleSelection extends NativeSampleSelection {
  weight: number
}

const NEAR_ROOT_WINDOW = 2
const MAX_ROOT_WINDOW = 4
const MAX_PITCH_BLEND_ROOT_SPAN = 6

function dbToGain(db: number) { return 10 ** (db / 20) }
function zoneColour(zone: TloqueSamplePack["zones"][number]) {
  return zone.vibratoColour ?? (zone.vibrato === true ? "vibrato" : "none")
}
function noteDistance(zone: TloqueSamplePack["zones"][number], note: number) {
  if (note >= zone.loMidi && note <= zone.hiMidi) return 0
  return note < zone.loMidi ? zone.loMidi - note : note - zone.hiMidi
}
function effectiveRoot(zone: TloqueSampleZone) {
  return zone.rootMidi - zone.tuneCents / 100
}
function selectionFor(zone: TloqueSampleZone, note: number, velocity: number): NativeSampleSelection {
  const semitones = note - zone.rootMidi + zone.tuneCents / 100
  const velocityGain = zone.amplitudeDynamic === false ? 1 : Math.max(0, Math.min(1, velocity / 127))
  return {
    zone,
    playbackRate: 2 ** (semitones / 12),
    gain: dbToGain(zone.gainDb) * velocityGain,
  }
}

function semanticZones(
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
      && noteDistance(zone, note) <= MAX_ROOT_WINDOW,
  )
  const exact = compatible(articulation)
  return exact.length || articulation === "normal" ? exact : compatible("normal")
}

function semanticLayers(zones: readonly TloqueSampleZone[]) {
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

function pitchBlendForLayer(
  zones: readonly TloqueSampleZone[],
  layer: { layer: number; lo: number; hi: number; center: number },
  note: number,
  velocity: number,
  roundRobin: number,
  allowPitchBlend: boolean,
): readonly WeightedNativeSampleSelection[] {
  const probeVelocity = Math.max(layer.lo, Math.min(layer.hi, Math.round(layer.center)))
  let candidates = zones.filter(zone =>
    zone.velocityLayer === layer.layer
      && probeVelocity >= zone.loVelocity
      && probeVelocity <= zone.hiVelocity,
  )
  const rrCandidates = candidates.filter(zone => zone.roundRobin === roundRobin)
  if (rrCandidates.length) candidates = rrCandidates
  const near = candidates.filter(zone => noteDistance(zone, note) <= NEAR_ROOT_WINDOW)
  if (near.length) candidates = near
  else candidates = candidates.filter(zone => noteDistance(zone, note) <= MAX_ROOT_WINDOW)
  if (!candidates.length) return []

  const uniqueByRoot = new Map<string, TloqueSampleZone>()
  for (const zone of candidates) {
    const key = effectiveRoot(zone).toFixed(4)
    const current = uniqueByRoot.get(key)
    if (!current || noteDistance(zone, note) < noteDistance(current, note)) uniqueByRoot.set(key, zone)
  }
  const roots = [...uniqueByRoot.values()].sort((a, b) => effectiveRoot(a) - effectiveRoot(b))
  const actualVelocity = Math.max(0, Math.min(127, velocity))
  const weighted = (zone: TloqueSampleZone, weight: number): WeightedNativeSampleSelection => {
    const selection = selectionFor(zone, note, actualVelocity)
    return { ...selection, gain: selection.gain * weight, weight }
  }
  if (roots.length === 1) return [weighted(roots[0], 1)]

  if (!allowPitchBlend) {
    const nearest = roots.reduce((best, zone) => Math.abs(note - effectiveRoot(zone)) < Math.abs(note - effectiveRoot(best)) ? zone : best)
    return [weighted(nearest, 1)]
  }

  let lower: TloqueSampleZone | null = null
  let upper: TloqueSampleZone | null = null
  for (const zone of roots) {
    const root = effectiveRoot(zone)
    if (root <= note) lower = zone
    if (root >= note && !upper) upper = zone
  }
  if (!lower) return [weighted(roots[0], 1)]
  if (!upper) return [weighted(roots[roots.length - 1], 1)]
  if (lower.id === upper.id) return [weighted(lower, 1)]

  const lowRoot = effectiveRoot(lower)
  const highRoot = effectiveRoot(upper)
  const span = highRoot - lowRoot
  if (span <= 0 || span > MAX_PITCH_BLEND_ROOT_SPAN) {
    return [weighted(Math.abs(note - lowRoot) <= Math.abs(highRoot - note) ? lower : upper, 1)]
  }
  const t = Math.max(0, Math.min(1, (note - lowRoot) / span))
  const lowWeight = Math.cos(t * Math.PI / 2)
  const highWeight = Math.sin(t * Math.PI / 2)
  return [weighted(lower, lowWeight), weighted(upper, highWeight)]
}

/**
 * Continuous multisample interpolation. Velocity layers retain equal-power blending.
 * Solo violin deliberately uses a single nearest pitch root to avoid phase beating,
 * doubled attacks and ensemble-like chorusing between independent recordings.
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

  const zones = semanticZones(pack, articulation, note, timbre)
  const layers = semanticLayers(zones)
  if (!layers.length) return []
  const velocity = Math.max(0, Math.min(127, midiVelocity))
  const allowPitchBlend = pack.instrumentManifestId !== "vsco2-ce-solo-violin"

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

  const lowPitchBlend = pitchBlendForLayer(zones, lower, note, velocity, roundRobin, allowPitchBlend)
  if (!lowPitchBlend.length) return []
  if (lower.layer === upper.layer) return lowPitchBlend
  const highPitchBlend = pitchBlendForLayer(zones, upper, note, velocity, roundRobin, allowPitchBlend)
  if (!highPitchBlend.length) return lowPitchBlend

  const span = Math.max(1, upper.center - lower.center)
  const t = Math.max(0, Math.min(1, (velocity - lower.center) / span))
  const lowVelocityWeight = Math.cos(t * Math.PI / 2)
  const highVelocityWeight = Math.sin(t * Math.PI / 2)
  return [
    ...lowPitchBlend.map(item => ({ ...item, gain: item.gain * lowVelocityWeight, weight: item.weight * lowVelocityWeight })),
    ...highPitchBlend.map(item => ({ ...item, gain: item.gain * highVelocityWeight, weight: item.weight * highVelocityWeight })),
  ]
}
