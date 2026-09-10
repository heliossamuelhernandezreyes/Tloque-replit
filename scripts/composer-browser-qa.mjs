import { build } from "esbuild"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import postcss from "postcss"
import tailwindcss from "tailwindcss"
import { compileTloqueScore } from "../shared/audio.ts"

// Local-only, allowlisted assets and in-memory test services. No production
// credentials, storage, sample downloads, database or repository directory serving.
const mocks = resolve("tests/browser/composerMocks.tsx")
const bundle = await build({
  entryPoints: [resolve("tests/browser/composer.tsx")], bundle: true, write: false,
  format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "qa-vite-asset-urls", setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: "qa-asset-url" }))
    builder.onLoad({ filter: /.*/, namespace: "qa-asset-url" }, () => ({ contents: 'export default "/qa-audio-worklet-not-loaded.js"', loader: "js" }))
  } }],
  alias: { "@/hooks/useAuth": mocks, "@/hooks/useSoundFX": mocks, "@/audio/MusicProvider": mocks, "@shared": resolve("shared"), "@": resolve("client/src") },
})
const html = await readFile("tests/browser/composer.html")
const skill = await readFile("client/public/downloads/TLOQUE_SCORE_AI_SKILL.md")
const css = await postcss([tailwindcss("tailwind.config.ts")]).process(await readFile("client/src/index.css", "utf8"), { from: resolve("client/src/index.css") })
const studio = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Estudio de prueba</title><link rel="stylesheet" href="/composer.css"></head><body><div id="root"></div><script type="module" src="/composer.js"></script></body></html>'
const assets = []
const server = createServer(async (req, res) => {
  const send = (status, type, body) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body) }
  const json = (status, body) => send(status, "application/json", JSON.stringify(body))
  if (req.method === "GET") {
    if (req.url === "/") return send(200, "text/html; charset=utf-8", html)
    if (req.url === "/studio") return send(200, "text/html; charset=utf-8", studio)
    if (req.url === "/composer.js") return send(200, "text/javascript", bundle.outputFiles[0].contents)
    if (req.url === "/composer.css") return send(200, "text/css", css.css)
    if (req.url === "/downloads/TLOQUE_SCORE_AI_SKILL.md") return send(200, "text/plain; charset=utf-8", skill)
    if (req.url === "/api/admin/audio/assets" || req.url === "/api/audio/assets") return json(200, { assets })
    if (req.url === "/api/admin/audio/ui-bindings") return json(200, { events: [], bindings: [], assets: [] })
  }
  if (["POST", "PUT"].includes(req.method) && (req.url === "/api/admin/audio/score/compile" || /^\/api\/admin\/audio\/assets(?:\/\d+)?$/.test(req.url))) {
    try {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 5_000_000) return json(413, { message: "QA body too large" }); chunks.push(chunk) }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const result = compileTloqueScore(body.source ?? body.scoreSource)
      if (req.url.endsWith("/compile")) return json(result.ok ? 200 : 400, result)
      if (!result.ok) return json(400, result)
      const id = Number(req.url.split("/").at(-1)) || assets.length + 1
      const asset = { ...body, id, recipe: result.recipe, favorite: false }
      const index = assets.findIndex(item => item.id === id)
      if (index < 0) assets.push(asset); else assets[index] = asset
      return json(200, { asset })
    } catch { return json(400, { message: "Invalid QA request" }) }
  }
  return send(404, "text/plain", "Not found")
})
server.listen(4179, "127.0.0.1", () => console.log("Composer QA: http://localhost:4179"))
