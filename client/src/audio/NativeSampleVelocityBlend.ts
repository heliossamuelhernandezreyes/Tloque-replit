import type { TloqueArticulation } from "@shared/instrument-manifest"
import type { TloqueSamplePack, TloqueSampleZone } from "@shared/native-sample-pack"
import { selectNativeSampleZone, type NativeSampleSelection, type NativeSampleTimbreRequest } from "./NativeSamplePackEngine"

export interface WeightedNativeSampleSelection extends NativeSampleSelection {
  weight: number
}

export interface DynamicNativeSampleSelection extends NativeSampleSelection {
  /** Unweighted sample gain above; this separate equal-power curve is applied
   * once by the player and holds its final value through the release tail. */
  layerGainCurve?: Float32Array
}

export const NATIVE_SAMPLE_LAYER_DYNAMICS_VERSION = "tloque-native-layer-dynamics-v1" as const
export const NATIVE_SAMPLE_LAYER_MAX_POINTS = 4096
export const NATIVE_SAMPLE_LAYER_MAX_SOURCES = 8

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
  amplitudeVelocity: number,
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
  const performedAmplitudeVelocity = Math.max(0, Math.min(127, amplitudeVelocity))
  const weighted = (zone: TloqueSampleZone, weight: number): WeightedNativeSampleSelection => {
    const selection = selectionFor(zone, note, performedAmplitudeVelocity)
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
function prepareVelocityBlend(
  pack: TloqueSamplePack,
  articulation: TloqueArticulation,
  note: number,
  amplitudeVelocity: number,
  roundRobin: number,
  timbre: NativeSampleTimbreRequest,
) {
  const zones = semanticZones(pack, articulation, note, timbre)
  const layers = semanticLayers(zones)
  const allowPitchBlend = pack.instrumentManifestId !== "vsco2-ce-solo-violin"
  const pitchBlends = new Map<number, readonly WeightedNativeSampleSelection[]>()
  const pitchBlend = (layer: typeof layers[number]) => {
    let blend = pitchBlends.get(layer.layer)
    if (!blend) {
      blend = pitchBlendForLayer(zones, layer, note, amplitudeVelocity, roundRobin, allowPitchBlend)
      pitchBlends.set(layer.layer, blend)
    }
    return blend
  }

  return (midiVelocity: number): readonly WeightedNativeSampleSelection[] => {
    if (!layers.length) return []
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

    const lowPitchBlend = pitchBlend(lower)
    if (!lowPitchBlend.length) return []
    if (lower.layer === upper.layer) return lowPitchBlend
    const highPitchBlend = pitchBlend(upper)
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
}

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
  return prepareVelocityBlend(pack, articulation, note, timbre.amplitudeVelocity ?? midiVelocity, roundRobin, timbre)(midiVelocity)
}

/** Select the union of recorded layers visited by one held note. All recordings
 * start together; only their gains move, so crossing a layer never retriggers an
 * attack. Pitch roots, RR, recorded colour and microphone stay fixed per layer.
 * No network/PCM work occurs here. The planner's zones drive bounded preload. */
export function selectNativeSampleVelocityTrajectory(
  pack: TloqueSamplePack,
  articulation: TloqueArticulation,
  note: number,
  midiVelocities: Float32Array,
  roundRobin: number,
  timbre: NativeSampleTimbreRequest = {},
): readonly DynamicNativeSampleSelection[] {
  if (midiVelocities.length < 2 || midiVelocities.length > NATIVE_SAMPLE_LAYER_MAX_POINTS
    || !midiVelocities.every(Number.isFinite)) throw new Error("Curva de capas nativas inválida o fuera del límite seguro")
  if ((timbre.trigger ?? "attack") !== "attack") {
    return selectNativeSampleVelocityBlend(pack, articulation, note, midiVelocities[0], roundRobin, timbre)
  }
  const amplitudeVelocity = timbre.amplitudeVelocity ?? midiVelocities[0]
  const select = prepareVelocityBlend(pack, articulation, note, amplitudeVelocity, roundRobin, timbre)
  const byZone = new Map<string, DynamicNativeSampleSelection & { layerGainCurve: Float32Array }>()
  for (let index = 0; index < midiVelocities.length; index += 1) {
    const blend = select(midiVelocities[index])
    if (!blend.length) throw new Error(`El módulo ${pack.instrumentManifestId} no cubre el crescendo en MIDI ${note}`)
    for (const item of blend) {
      if (item.weight < 1e-8) continue
      let voice = byZone.get(item.zone.id)
      if (!voice) {
        if (byZone.size >= NATIVE_SAMPLE_LAYER_MAX_SOURCES) throw new Error(`El módulo ${pack.instrumentManifestId} supera ${NATIVE_SAMPLE_LAYER_MAX_SOURCES} fuentes por nota sostenida; reduce el recorrido dinámico o usa un banco con menos capas`)
        voice = { ...selectionFor(item.zone, note, amplitudeVelocity), layerGainCurve: new Float32Array(midiVelocities.length) }
        byZone.set(item.zone.id, voice)
      }
      voice.layerGainCurve[index] = item.weight
    }
  }
  const voices = [...byZone.values()]
  // One-layer banks and constant expressions retain the historical static path.
  if (voices.every(voice => voice.layerGainCurve.every(value => Math.abs(value - voice.layerGainCurve[0]) < 1e-7))) {
    return select(midiVelocities[0]).filter(item => item.weight >= 1e-8)
  }
  return voices
}
