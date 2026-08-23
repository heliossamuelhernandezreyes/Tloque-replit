import type { AudioRecipe, AudioSourceType } from "@shared/audio"
import type { MusicCue } from "./MusicEngine"

export interface CatalogAudioAsset {
  id: number
  title: string
  artist: string
  kind: "music" | "ambience" | "system"
  sourceType: AudioSourceType
  url: string
  recipe: AudioRecipe | null
  musicalKey: string
  musicalMode: string
  brightness: number
  texture: string
  tags: string[]
  packUrl: string
  packBytes: number | null
  packSha256: string
  instrumentProgram: number | null
  emotion: string
  bpm: number | null
  energy: number
  durationSeconds: number | null
  loop: boolean
  license: string
  sourceName: string
  sourceUrl: string
  status: "draft" | "published" | "archived"
  favorite?: boolean
}

export interface ChapterAudioAssignment {
  id?: number
  chapterIndex: number
  assetId: number
  volume: number
  loop: boolean
  crossfadeSeconds: number
  updatedAt?: string
  asset: CatalogAudioAsset
}

export const INSTRUMENT_MANIFEST_TAG_PREFIX = "manifest:"

export function instrumentManifestIdForAsset(asset: Pick<CatalogAudioAsset, "tags">): string | null {
  const tag = asset.tags.find(value => value.startsWith(INSTRUMENT_MANIFEST_TAG_PREFIX))
  const id = tag?.slice(INSTRUMENT_MANIFEST_TAG_PREFIX.length).trim()
  return id || null
}

export function musicCueFor(asset: CatalogAudioAsset, options?: {
  volume?: number
  loop?: boolean
  crossfadeSeconds?: number
}): MusicCue {
  return {
    id: asset.id,
    title: asset.title,
    artist: asset.artist,
    sourceType: asset.sourceType || "stream",
    url: asset.url,
    recipe: asset.recipe,
    packUrl: asset.packUrl,
    packBytes: asset.packBytes,
    packSha256: asset.packSha256,
    instrumentProgram: asset.instrumentProgram,
    instrumentManifestId: instrumentManifestIdForAsset(asset),
    loop: options?.loop ?? asset.loop,
    volume: options?.volume ?? 0.35,
    crossfadeSeconds: options?.crossfadeSeconds ?? 6,
  }
}
