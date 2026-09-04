import { build } from "esbuild"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

// Local-only validation surface: serves three known files, never the repository,
// secrets, database, sample bucket or the authenticated application.
const html = await readFile(new URL("../tests/browser/orchestra.html", import.meta.url))
const stringWorklet = await readFile(new URL("../client/public/audio-worklets/tloque-bowed-string-v3.js", import.meta.url))
const result = await build({
  entryPoints: [resolve("tests/browser/orchestra.ts")], bundle: true, write: false,
  format: "esm", platform: "browser", target: "es2022",
  alias: { "@shared": resolve("shared"), "@": resolve("client/src") },
})
const javascript = result.outputFiles[0].contents
const server = createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(html) }
  else if (req.url === "/orchestra.js") { res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }); res.end(javascript) }
  else if (req.url?.startsWith("/audio-worklets/tloque-bowed-string-v3.js")) { res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }); res.end(stringWorklet) }
  else { res.writeHead(404); res.end("Not found") }
})
server.listen(4178, "127.0.0.1", () => console.log("Audio QA: http://localhost:4178"))
