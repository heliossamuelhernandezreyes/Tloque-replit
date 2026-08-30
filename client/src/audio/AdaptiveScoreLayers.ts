import type { MusicBrainAudioLayer, MusicBrainScoreV1 } from "@shared/music-brain"

export function adaptiveLayersForRegion(
  score: MusicBrainScoreV1,
  catalog: readonly MusicBrainAudioLayer[],
  regionId?: string | null,
) {
  const region = score.regions.find(candidate => candidate.id === regionId) ?? score.regions[0]
  if (!region || region.silence || !region.scoreId) return []
  const explicit = new Set(region.layerIds)
  return catalog.filter(layer => layer.scoreId === region.scoreId
    && (explicit.size === 0 || explicit.has(layer.id)))
}
