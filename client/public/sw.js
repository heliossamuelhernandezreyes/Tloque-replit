const SHELL_CACHE = "tloque-shell-v1"
const RUNTIME_CACHE = "tloque-static-v1"
const PRINT_CACHE = "tloque-print-v2"
// AudioResourceCache owns this cache. Service-worker upgrades must preserve it:
// deleting it here silently removes every module the reader explicitly saved.
const AUDIO_CACHE = "tloque-audio-v2"
const SHELL = ["/", "/favicon.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"]

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("message", event => {
  if (event.data?.type === "PRINT_CAPABILITIES") event.ports[0]?.postMessage({ version: 2 })
})

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, AUDIO_CACHE, PRINT_CACHE])
    await Promise.all((await caches.keys()).filter(key => !keep.has(key)).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", event => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE)
          await cache.put("/", response.clone())
        }
        return response
      } catch {
        return (await caches.match("/")) || Response.error()
      }
    })())
    return
  }

  // Fonts loaded through fetch() have an empty destination. Module workers
  // have destination "worker". Both are required for offline print export.
  const printAsset = url.pathname.startsWith("/assets/") && /(?:print\.worker-|SourceSerif4-|DejaVuSans-)/.test(url.pathname)
  if (["script", "style", "font", "image", "worker", "sharedworker"].includes(request.destination) || printAsset) {
    event.respondWith((async () => {
      // These are immutable, public build assets. A font fetched by CSS can
      // differ in its Origin header from the worker's fetch() despite having
      // identical bytes. Vary: Origin must not defeat offline font lookup.
      const cached = printAsset ? await (await caches.open(PRINT_CACHE)).match(url.pathname, { ignoreVary: true }) : await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(printAsset ? PRINT_CACHE : RUNTIME_CACHE)
        await cache.put(request, response.clone())
      }
      return response
    })())
  }
})
