import type { TloqueSampleZone } from "@shared/native-sample-pack"
import type { NativeSampleScorePlan } from "./NativeSampleScorePlan"

export const NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS = 8
export const NATIVE_SAMPLE_RELEASE_GRACE_SECONDS = 2

export interface NativeSamplePreloadItem {
  readonly zone: TloqueSampleZone
  readonly firstUseSeconds: number
  readonly lastUseSeconds: number
  readonly preloadAtSeconds: number
  readonly releaseAtSeconds: number
}

/**
 * Builds one lifecycle entry per physical sample URL.
 *
 * The score plan already contains only zones selected by the performance plan.
 * Realtime playback can therefore warm each WAV shortly before first use and
 * drop the player's retained decode after its final scheduled use instead of
 * decoding every selected sample before playback begins.
 */
export function buildNativeProgressivePreloadPlan(
  plan: NativeSampleScorePlan,
  leadSeconds = NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS,
  releaseGraceSeconds = NATIVE_SAMPLE_RELEASE_GRACE_SECONDS,
): readonly NativeSamplePreloadItem[] {
  const byUrl = new Map<string, TloqueSampleZone>()
  for (const zone of plan.zones) if (!byUrl.has(zone.sampleUrl)) byUrl.set(zone.sampleUrl, zone)

  const useByUrl = new Map<string, { first: number; last: number }>()
  for (const voice of [...plan.voices, ...plan.auxiliaryVoices]) {
    const end = voice.startSeconds + Math.max(0.01, voice.durationSeconds)
    const existing = useByUrl.get(voice.sampleUrl)
    if (existing) {
      existing.first = Math.min(existing.first, voice.startSeconds)
      existing.last = Math.max(existing.last, end)
    } else {
      useByUrl.set(voice.sampleUrl, { first: voice.startSeconds, last: end })
    }
  }

  return [...useByUrl.entries()]
    .map(([sampleUrl, use]) => {
      const zone = byUrl.get(sampleUrl)
      if (!zone) return null
      return {
        zone,
        firstUseSeconds: use.first,
        lastUseSeconds: use.last,
        preloadAtSeconds: Math.max(0, use.first - Math.max(0, leadSeconds)),
        releaseAtSeconds: use.last + Math.max(0, releaseGraceSeconds),
      }
    })
    .filter((item): item is NativeSamplePreloadItem => item !== null)
    .sort((a, b) => a.preloadAtSeconds - b.preloadAtSeconds || a.firstUseSeconds - b.firstUseSeconds || a.zone.sampleUrl.localeCompare(b.zone.sampleUrl))
}
