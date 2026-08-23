import type { LinearScoreTrack } from "@shared/audio"
import {
  BUILTIN_INSTRUMENT_MANIFESTS,
  type InstrumentArticulationRoute,
  type InstrumentManifest,
  type TloqueArticulation,
} from "@shared/instrument-manifest"

export interface PerformanceRoute {
  manifestId: string | null
  articulation: TloqueArticulation
  program: number
  source: "dedicated-articulation" | "base-program"
  route: InstrumentArticulationRoute | null
}

export function baseProgramForTrack(track: LinearScoreTrack): number {
  if ("program" in track) return track.program
  return ({ warm: 0, pad: 48, bell: 8, pluck: 24, bass: 32 } as const)[track.synth]
}

function semanticInstrumentId(track: LinearScoreTrack): string | null {
  return "instrument" in track ? track.instrument : null
}

export function resolveInstrumentManifest(
  track: LinearScoreTrack,
  manifests: readonly InstrumentManifest[] = BUILTIN_INSTRUMENT_MANIFESTS,
): InstrumentManifest | null {
  const instrument = semanticInstrumentId(track)
  const program = baseProgramForTrack(track)

  if (instrument) {
    const exact = manifests.find(manifest => manifest.instruments.includes(instrument))
    if (exact) return exact
  }
  return manifests.find(manifest => manifest.basePrograms.includes(program)) ?? null
}

export function resolvePerformanceRoute(
  track: LinearScoreTrack,
  articulation: TloqueArticulation = "normal",
  manifests: readonly InstrumentManifest[] = BUILTIN_INSTRUMENT_MANIFESTS,
): PerformanceRoute {
  const baseProgram = baseProgramForTrack(track)
  const manifest = resolveInstrumentManifest(track, manifests)
  const route = manifest?.articulations.find(item => item.articulation === articulation) ?? null

  return {
    manifestId: manifest?.id ?? null,
    articulation,
    program: route?.program ?? baseProgram,
    source: route?.program === undefined ? "base-program" : "dedicated-articulation",
    route,
  }
}

/**
 * Stable selector for future round-robin sample groups. It is intentionally
 * renderer-agnostic: manifests can expose N alternates and every renderer can
 * choose the same take from the score seed/event identity.
 */
export function deterministicRoundRobinIndex(seed: number, identity: string, count: number): number {
  if (!Number.isInteger(count) || count <= 1) return 0
  let hash = (seed ^ 0x811c9dc5) >>> 0
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % count
}
