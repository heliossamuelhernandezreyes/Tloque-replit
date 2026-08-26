const CACHE_NAME = "tloque-audio-v2"

function isMutableSamplePackAlias(url: string) {
  return url.startsWith("/api/audio/sample-packs/modules/")
}

async function cacheInstance(): Promise<Cache | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null
  return caches.open(CACHE_NAME)
}

export async function isAudioResourceCached(url: string): Promise<boolean> {
  if (isMutableSamplePackAlias(url)) return false
  const cache = await cacheInstance()
  return Boolean(cache && await cache.match(url))
}

export async function cacheAudioResource(url: string, expectedSha256 = ""): Promise<void> {
  if (isMutableSamplePackAlias(url)) throw new Error("Los aliases mutables de bancos no se guardan offline; usa un manifest inmutable")
  const cache = await cacheInstance()
  if (!cache) throw new Error("El almacenamiento de audio no está disponible en este dispositivo")
  const response = await fetch(url, { mode: "cors", credentials: "omit" })
  if (!response.ok) throw new Error(`No se pudo descargar el audio (${response.status})`)
  if (expectedSha256) {
    const bytes = await response.clone().arrayBuffer()
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(value => value.toString(16).padStart(2, "0")).join("")
    if (hash !== expectedSha256.toLowerCase()) throw new Error("La descarga no coincide con la huella publicada")
  }
  await cache.put(url, response)
}

export async function removeCachedAudioResource(url: string): Promise<void> {
  const cache = await cacheInstance()
  if (cache) await cache.delete(url)
}

export async function fetchAudioResource(url: string): Promise<Response> {
  // /modules/<id>.json is a mutable server alias. Reading it from Cache Storage can
  // bind a new installation to an obsolete manifest indefinitely, so always revalidate.
  if (isMutableSamplePackAlias(url)) {
    return fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" })
  }
  const cache = await cacheInstance()
  const cached = await cache?.match(url)
  if (cached) return cached
  return fetch(url, { mode: "cors", credentials: "omit" })
}

export async function cachedObjectUrl(url: string): Promise<string | null> {
  if (isMutableSamplePackAlias(url)) return null
  const cache = await cacheInstance()
  const cached = await cache?.match(url)
  return cached ? URL.createObjectURL(await cached.blob()) : null
}
