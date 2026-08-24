import { CURATED_SAMPLE_PACKS, type CuratedSamplePackSource } from "./curated-sample-packs"
import { CURATED_RAW_WAV_PACKS } from "./curated-raw-wav-packs"
import { CURATED_EXTERNAL_PCM_PACKS } from "./curated-external-pcm-packs"

/**
 * Single source of truth for every sample pack that the admin installer can publish.
 * The UI should not care whether the upstream is SFZ, raw WAV, or institutional PCM.
 */
export const CURATED_INSTALLABLE_SAMPLE_PACKS: readonly CuratedSamplePackSource[] = [
  ...CURATED_SAMPLE_PACKS,
  ...CURATED_RAW_WAV_PACKS,
  ...CURATED_EXTERNAL_PCM_PACKS,
]

export function curatedInstallableSamplePackById(id: string | null | undefined): CuratedSamplePackSource | null {
  if (!id) return null
  return CURATED_INSTALLABLE_SAMPLE_PACKS.find(pack => pack.id === id) ?? null
}
