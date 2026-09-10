import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import assert from "node:assert/strict"

// Run against the ephemeral PostgreSQL service in CI, never a reader's database.
if (process.env.CI !== "true") throw new Error("Esta comprobación usa exclusivamente la base efímera de CI")
const port = 5189
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ["dist/index.cjs"], {
  env: { ...process.env, NODE_ENV: "development", SERVE_STATIC: "true", PORT: String(port), ADMIN_EMAIL: "" },
  stdio: ["ignore", "pipe", "pipe"],
})
let output = ""
const append = chunk => { output = (output + chunk.toString()).slice(-12_000) }
server.stdout.on("data", append)
server.stderr.on("data", append)
let exited = false
const stopped = new Promise(resolve => server.once("exit", () => { exited = true; resolve() }))

try {
  let healthy = false
  const deadline = Date.now() + 25_000
  while (!healthy && Date.now() < deadline && !exited) {
    try { healthy = (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1000) })).ok } catch {}
    if (!healthy) await delay(150)
  }
  assert.ok(healthy, `El servidor compilado no arrancó:\n${output}`)
  const ready = await fetch(`${origin}/readyz`)
  assert.equal(ready.status, 200, "PostgreSQL debe estar disponible")
  const home = await fetch(origin)
  assert.equal(home.status, 200)
  assert.match(home.headers.get("content-type") || "", /text\/html/)
  const html = await home.text()
  assert.doesNotMatch(html, /@vite\/client/, "Replit debe servir el build, no miles de módulos de desarrollo")
  const bundle = html.match(/src="(\/assets\/[^" ]+\.js)"/)
  assert.ok(bundle, "index debe apuntar al JavaScript compilado")
  const script = await fetch(`${origin}${bundle[1]}`)
  assert.equal(script.status, 200)
  assert.match(script.headers.get("content-type") || "", /javascript/)
  const session = await fetch(`${origin}/api/auth/me`)
  assert.equal(session.status, 401, "sin sesión no debe concederse acceso")
  const absent = await fetch(`${origin}/api/tloque-ci-route-missing`)
  assert.equal(absent.status, 404)
  assert.match(absent.headers.get("content-type") || "", /application\/json/)
  console.log("Arranque Replit verificado: servidor, PostgreSQL, HTML, bundle y límites de sesión/API")
} finally {
  if (!exited) server.kill("SIGTERM")
  await Promise.race([stopped, delay(3000)])
  if (!exited) { server.kill("SIGKILL"); await stopped }
}
