import type { TloqueSampleZone } from "@shared/native-sample-pack"
import type { NativeSampleScorePlan } from "./NativeSampleScorePlan"

export const NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS = 8

export interface NativeSamplePreloadItem {
  readonly zone: TloqueSampleZone
  readonly firstUseSeconds: number
  readonly preloadAtSeconds: number
}

/**
 * Builds one preload task per physical sample URL, timed before its first use.
 * The plan already contains only zones actually selected by the score, so this
 * avoids decoding the entire piece at startup without ever fetching unused pack
 * material. Multiple voices sharing a WAV share the same preload item.
 */
export function buildNativeProgressivePreloadPlan(
  plan: NativeSampleScorePlan,
  leadSeconds = NATIVE_SAMPLE_PRELOAD_LEAD_SECONDS,
): readonly NativeSamplePreloadItem[] {
  const zoneById = new Map(plan.zones.map(zone => [zone.id, zone]))
  const firstUseByUrl = new Map<string, number>()

  for (const voice of [...plan.voices, ...plan.auxiliaryVoices]) {
    const previous = firstUseByUrl.get(voice.sampleUrl)
    if (previous === undefined || voice.startSeconds < previous) firstUseByUrl.set(voice.sampleUrl, voice.startSeconds)
  }

  const byUrl = new Map<string, TloqueSampleZone>()
  for (const zone of zoneById.values()) if (!byUrl.has(zone.sampleUrl)) byUrl.set(zone.sampleUrl, zone)

  return [...firstUseByUrl.entries()]
    .map(([sampleUrl, firstUseSeconds]) => {
      const zone = byUrl.get(sampleUrl)
      if (!zone) return null
      return {
        zone,
        firstUseSeconds,
        preloadAtSeconds: Math.max(0, firstUseSeconds - Math.max(0, leadSeconds)),
      }
    })
    .filter((item): item is NativeSamplePreloadItem => item !== null)
    .sort((a, b) => a.preloadAtSeconds - b.preloadAtSeconds || a.firstUseSeconds - b.firstUseSeconds || a.zone.sampleUrl.localeCompare(b.zone.sampleUrl))
}
