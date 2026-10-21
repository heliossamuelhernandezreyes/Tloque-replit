const CACHE = "tloque-print-v2"
interface PrintAssets { version: 2; worker: string; build: string; assets: string[] }
export async function prepareOfflinePrint(workerUrl: string): Promise<boolean> {
  if (!("caches" in globalThis) || !("serviceWorker" in navigator)) return false
  const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>(resolve => setTimeout(resolve, 5000))])
  if (!registration?.active) return false
  const supportsPrint = () => new Promise<boolean>(resolve => {
    const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); resolve(false) }, 1200)
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.version === 2) }
    registration.active?.postMessage({ type: "PRINT_CAPABILITIES" }, [channel.port2])
  })
  // An older active worker cannot serve module-worker requests from our cache.
  // Give an installing update one more opportunity; never report false readiness.
  if (!await supportsPrint() && !await supportsPrint()) return false
  const worker = new URL(workerUrl, location.origin).pathname, cache = await caches.open(CACHE)
  const index = "/print-offline/" + worker.split("/").at(-1) + ".json"
  let manifest: PrintAssets
  try {
    const response = await fetch("/print-assets.json", { cache: "no-store", signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error("offline")
    manifest = await response.json()
  } catch {
    const saved = await cache.match(index)
    if (!saved) return false
    manifest = await saved.json()
  }
  if (manifest.version !== 2 || manifest.worker !== worker || !/^[a-f0-9]{64}$/.test(manifest.build)
    || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 100
    || !manifest.assets.every(path => typeof path === "string" && /^\/assets\/[\w.-]+\.(?:js|css|ttf)$/.test(path))
    || !manifest.assets.includes(worker)) return false
  // Do not persist readiness until all build resources have arrived. Partial
  // downloads can be resumed; a missing source never masquerades as readiness.
  for (const path of manifest.assets) {
    if (await cache.match(path, { ignoreVary: true })) continue
    const response = await fetch(path, { signal: AbortSignal.timeout(20000) })
    const type = response.headers.get("content-type") || ""
    if (!response.ok || /text\/html/i.test(type)) return false
    await cache.put(path, response)
  }
  await cache.put(index, new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }))
  return true
}
