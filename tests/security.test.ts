import test from "node:test"
import assert from "node:assert/strict"
import { isSafeHttpsUrl, isSafeStorageKey } from "../shared/media"
import { checkInvariants, poolCushion, TICKET } from "../shared/gacha"
import { rateLimit } from "../server/rateLimit"
import { securityHeaders } from "../server/security"

function responseHeaders(path: string, nodeEnv: "development" | "production") {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  const headers = new Map<string, string>()
  try {
    securityHeaders(
      { path, secure: false } as any,
      { setHeader: (name: string, value: string) => headers.set(name, String(value)) } as any,
      () => undefined,
    )
    return headers
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}

test("desarrollo permite el preámbulo de Vite sin debilitar producción", () => {
  const development = responseHeaders("/", "development")
  const developmentCsp = development.get("Content-Security-Policy") || ""
  assert.match(developmentCsp, /script-src 'self' 'unsafe-inline'/)
  assert.match(developmentCsp, /frame-ancestors 'self' https:\/\/replit\.com https:\/\/\*\.replit\.com/)
  assert.equal(development.has("X-Frame-Options"), false)

  const production = responseHeaders("/", "production")
  const productionCsp = production.get("Content-Security-Policy") || ""
  assert.match(productionCsp, /script-src 'self'(?:;|$)/)
  assert.doesNotMatch(productionCsp, /script-src[^;]*'unsafe-inline'/)
  assert.match(productionCsp, /frame-ancestors 'none'/)
  assert.equal(production.get("X-Frame-Options"), "DENY")
})

test("el taller conserva su política aislada", () => {
  const workshop = responseHeaders("/taller-marcos.html", "production")
  const csp = workshop.get("Content-Security-Policy") || ""
  assert.match(csp, /script-src 'self' 'unsafe-inline'/)
  assert.match(csp, /frame-ancestors 'self'/)
  assert.equal(workshop.get("X-Frame-Options"), "SAMEORIGIN")
})

test("las claves de audiolibro nunca escapan del almacenamiento", () => {
  for (const valid of ["books/12/chapter-0.mp3", "cache/a.b-c_1/audio.m4a"]) {
    assert.equal(isSafeStorageKey(valid), true, valid)
  }
  for (const invalid of ["", "/etc/passwd", "../secret", "books/../secret", "books\\secret.mp3", "books//x.mp3", "./x.mp3", "books/"]) {
    assert.equal(isSafeStorageKey(invalid), false, invalid)
  }
})

test("las salidas HTTPS no aceptan credenciales ni esquemas alternos", () => {
  assert.equal(isSafeHttpsUrl("https://storage.example/audio.mp3"), true)
  assert.equal(isSafeHttpsUrl("http://storage.example/audio.mp3"), false)
  assert.equal(isSafeHttpsUrl("https://user:secret@storage.example/audio.mp3"), false)
  assert.equal(isSafeHttpsUrl("file:///etc/passwd"), false)
})

test("el límite global no se evade cambiando la ruta", () => {
  const middleware = rateLimit(60_000, 2, "api-global")
  let allowed = 0
  let denied = 0
  const request = (path: string) => ({
    ip: "203.0.113.7",
    method: "POST",
    path,
    isAuthenticated: () => false,
  }) as any
  const response = {
    setHeader: () => undefined,
    status(code: number) {
      assert.equal(code, 429)
      denied++
      return this
    },
    json: () => undefined,
  } as any
  middleware(request("/one"), response, () => { allowed++ })
  middleware(request("/two"), response, () => { allowed++ })
  middleware(request("/three"), response, () => { allowed++ })
  assert.equal(allowed, 2)
  assert.equal(denied, 1)
})

test("el sorteo cuesta veinte pesos y conserva solvencia matemática", () => {
  assert.deepEqual(TICKET, { price: 10, direct: 3, pool: 4, house: 3 })
  assert.deepEqual(checkInvariants(), { ok: true })
  assert.ok(poolCushion() > 0)
})
