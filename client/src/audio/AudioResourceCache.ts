import { validateTloqueSamplePack, type TloqueSamplePack } from "@shared/native-sample-pack"
import type { MusicBrainAudioLayer, MusicBrainScoreV1 } from "@shared/music-brain"
import { renderMusicBrainRegion } from "@shared/music-brain-renderer"
import { nativeModuleGroupsForRecipe } from "./NativeAutoModule"
import { adaptiveLayersForRegion } from "./AdaptiveScoreLayers"

const CACHE_NAME = "tloque-audio-v2"
const OFFLINE_MODULE_PREFIX = "/__tloque_audio_module__/"

function isMutableSamplePackAlias(url: string) {
  return url.startsWith("/api/audio/sample-packs/modules/")
}

function offlineModulePointerUrl(url: string) {
  return `${OFFLINE_MODULE_PREFIX}${encodeURIComponent(url)}`
}

async function sha256Hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(value => value.toString(16).padStart(2, "0")).join("")
}

async function verifiedResponse(response: Response, expectedSha256 = "") {
  const bytes = await response.arrayBuffer()
  if (expectedSha256 && await sha256Hex(bytes) !== expectedSha256.toLowerCase()) {
    throw new Error("La descarga no coincide con la huella publicada")
  }
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

interface OfflineModulePointer {
  version: 1
  aliasUrl: string
  immutableUrl: string
  sampleUrls: string[]
  savedAt: string
}

async function readOfflineModulePointer(cache: Cache, aliasUrl: string): Promise<OfflineModulePointer | null> {
  const response = await cache.match(offlineModulePointerUrl(aliasUrl))
  if (!response) return null
  const value = await response.json().catch(() => null) as OfflineModulePointer | null
  return value?.version === 1 && value.aliasUrl === aliasUrl ? value : null
}

async function resourcesReferencedByOtherModules(cache: Cache, excludedAliasUrl: string) {
  const referenced = new Set<string>()
  for (const request of await cache.keys()) {
    let pathname = ""
    try { pathname = new URL(request.url).pathname } catch { continue }
    if (!pathname.startsWith(OFFLINE_MODULE_PREFIX)) continue
    const response = await cache.match(request)
    const pointer = response ? await response.json().catch(() => null) as OfflineModulePointer | null : null
    if (!pointer || pointer.version !== 1 || pointer.aliasUrl === excludedAliasUrl) continue
    referenced.add(pointer.immutableUrl)
    pointer.sampleUrls.forEach(url => referenced.add(url))
  }
  return referenced
}

async function cacheInstance(): Promise<Cache | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null
  return caches.open(CACHE_NAME)
}

export async function isAudioResourceCached(url: string): Promise<boolean> {
  const cache = await cacheInstance()
  if (!cache) return false
  if (!isMutableSamplePackAlias(url)) return Boolean(await cache.match(url))
  const pointer = await readOfflineModulePointer(cache, url)
  if (!pointer || !await cache.match(pointer.immutableUrl)) return false
  const samples = await Promise.all(pointer.sampleUrls.map(sampleUrl => cache.match(sampleUrl)))
  return samples.every(Boolean)
}

export async function cacheAudioResource(url: string, expectedSha256 = ""): Promise<void> {
  if (isMutableSamplePackAlias(url)) {
    await cacheNativeSamplePack(url)
    return
  }
  const cache = await cacheInstance()
  if (!cache) throw new Error("El almacenamiento de audio no está disponible en este dispositivo")
  const response = await fetch(url, { mode: "cors", credentials: "omit" })
  if (!response.ok) throw new Error(`No se pudo descargar el audio (${response.status})`)
  await cache.put(url, await verifiedResponse(response, expectedSha256))
}

/**
 * Saves an entire native pack, not the mutable alias alone. The alias is
 * resolved online to a content-addressed manifest and every referenced WAV is
 * verified before the offline pointer is committed atomically.
 */
export async function cacheNativeSamplePack(aliasUrl: string): Promise<TloqueSamplePack> {
  if (!isMutableSamplePackAlias(aliasUrl)) throw new Error("El módulo nativo debe usar el alias interno publicado")
  const cache = await cacheInstance()
  if (!cache) throw new Error("El almacenamiento de audio no está disponible en este dispositivo")
  const previous = await readOfflineModulePointer(cache, aliasUrl)
  const response = await fetch(aliasUrl, { mode: "cors", credentials: "omit", cache: "no-store" })
  if (!response.ok) throw new Error(`No se pudo descargar el manifest nativo (${response.status})`)
  const manifestBytes = await response.arrayBuffer()
  const pack = validateTloqueSamplePack(JSON.parse(new TextDecoder().decode(manifestBytes)))
  const manifestSha256 = await sha256Hex(manifestBytes)
  const immutableUrl = `/api/audio/sample-packs/manifests/${manifestSha256}.json`
  const sampleByUrl = new Map(pack.zones.map(zone => [zone.sampleUrl, zone.sha256 ?? ""]))

  // Keep network pressure predictable on mobile and commit the pointer only
  // after every physical resource is present and verified.
  const entries = [...sampleByUrl.entries()]
  for (let offset = 0; offset < entries.length; offset += 3) {
    await Promise.all(entries.slice(offset, offset + 3).map(async ([sampleUrl, expectedSha256]) => {
      if (await cache.match(sampleUrl)) return
      const sample = await fetch(sampleUrl, { mode: "cors", credentials: "omit" })
      if (!sample.ok) throw new Error(`No se pudo descargar una muestra nativa (${sample.status})`)
      await cache.put(sampleUrl, await verifiedResponse(sample, expectedSha256))
    }))
  }

  await cache.put(immutableUrl, new Response(manifestBytes, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
  }))
  const pointer: OfflineModulePointer = {
    version: 1,
    aliasUrl,
    immutableUrl,
    sampleUrls: [...sampleByUrl.keys()],
    savedAt: new Date().toISOString(),
  }
  await cache.put(offlineModulePointerUrl(aliasUrl), new Response(JSON.stringify(pointer), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }))
  if (previous) {
    const retained = await resourcesReferencedByOtherModules(cache, aliasUrl)
    retained.add(pointer.immutableUrl)
    pointer.sampleUrls.forEach(url => retained.add(url))
    await Promise.all([previous.immutableUrl, ...previous.sampleUrls]
      .filter(resource => !retained.has(resource))
      .map(resource => cache.delete(resource)))
  }
  return pack
}

function nativeAliasesForMusicBrain(score: MusicBrainScoreV1, layers: readonly MusicBrainAudioLayer[] = []) {
  const aliases = new Set<string>()
  for (const region of score.regions) {
    if (adaptiveLayersForRegion(score, layers, region.id).length) continue
    const rendered = renderMusicBrainRegion(score, region.id)
    if (!rendered.recipe) continue
    for (const group of nativeModuleGroupsForRecipe(rendered.recipe)) {
      aliases.add(`/api/audio/sample-packs/modules/${encodeURIComponent(group.moduleId)}.json`)
    }
  }
  return [...aliases]
}

function adaptiveLayerUrlsForMusicBrain(score: MusicBrainScoreV1, layers: readonly MusicBrainAudioLayer[]) {
  return [...new Set(score.regions.flatMap(region => adaptiveLayersForRegion(score, layers, region.id).map(layer => layer.url)))]
}

export async function isMusicBrainScoreCached(score: MusicBrainScoreV1, layers: readonly MusicBrainAudioLayer[] = []) {
  const resources = [...nativeAliasesForMusicBrain(score, layers), ...adaptiveLayerUrlsForMusicBrain(score, layers)]
  const values = await Promise.all(resources.map(isAudioResourceCached))
  return values.every(Boolean)
}

export async function cacheMusicBrainScoreResources(
  score: MusicBrainScoreV1,
  onProgress?: (value: number) => void,
  layers: readonly MusicBrainAudioLayer[] = [],
) {
  const aliases = nativeAliasesForMusicBrain(score, layers)
  const layerUrls = adaptiveLayerUrlsForMusicBrain(score, layers)
  const total = aliases.length + layerUrls.length
  if (!total) onProgress?.(1)
  let completed = 0
  for (const alias of aliases) {
    await cacheNativeSamplePack(alias)
    completed += 1; onProgress?.(completed / total)
  }
  for (const url of layerUrls) {
    await cacheAudioResource(url)
    completed += 1; onProgress?.(completed / total)
  }
}

export async function removeCachedAudioResource(url: string): Promise<void> {
  const cache = await cacheInstance()
  if (!cache) return
  if (!isMutableSamplePackAlias(url)) {
    await cache.delete(url)
    return
  }
  const pointer = await readOfflineModulePointer(cache, url)
  if (pointer) {
    const retained = await resourcesReferencedByOtherModules(cache, url)
    await Promise.all([pointer.immutableUrl, ...pointer.sampleUrls]
      .filter(resource => !retained.has(resource))
      .map(resource => cache.delete(resource)))
  }
  await cache.delete(offlineModulePointerUrl(url))
}

export async function fetchAudioResource(url: string): Promise<Response> {
  // /modules/<id>.json is a mutable server alias. Reading it from Cache Storage can
  // bind a new installation to an obsolete manifest indefinitely, so always revalidate.
  if (isMutableSamplePackAlias(url)) {
    try {
      const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" })
      if (response.ok) return response
    } catch { /* offline fallback below */ }
    const cache = await cacheInstance()
    const pointer = cache ? await readOfflineModulePointer(cache, url) : null
    const offline = pointer ? await cache?.match(pointer.immutableUrl) : null
    return offline ?? new Response(null, { status: 503, statusText: "Native module unavailable offline" })
  }
  const cache = await cacheInstance()
  const cached = await cache?.match(url)
  if (cached) return cached
  return fetch(url, { mode: "cors", credentials: "omit" })
}

export async function cachedObjectUrl(url: string): Promise<string | null> {
  const cache = await cacheInstance()
  const pointer = cache && isMutableSamplePackAlias(url) ? await readOfflineModulePointer(cache, url) : null
  const cached = await cache?.match(pointer?.immutableUrl ?? url)
  return cached ? URL.createObjectURL(await cached.blob()) : null
}
