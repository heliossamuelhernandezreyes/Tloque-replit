import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { once } from "node:events"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import express from "express"
import { legalConfiguration } from "../server/legalConfig"
import { publicationAcceptanceSchema, privacyRequestSchema, type PublicationAcceptance } from "../shared/legal"
import * as schema from "../shared/schema"
import { permissionsForRole } from "../shared/admin-permissions"

const config = {
  LEGAL_OPERATOR_NAME: "Operador simulado del catálogo", LEGAL_OPERATOR_ADDRESS: "Domicilio simulado 123, Monterrey, Nuevo León",
  LEGAL_PRIVACY_EMAIL: "contacto@fixture.mx", LEGAL_SUPPORT_PHONE: "8180000000",
  LEGAL_PUBLICATION_REVIEW_REF: "fixture-publicacion", LEGAL_COMMERCIAL_REVIEW_REF: "fixture-comercial", TINTA_LEGAL_REVIEW_REF: "fixture-tinta",
}
const previous = Object.fromEntries([...Object.keys(config), "DATABASE_URL"].map(key => [key, process.env[key]]))
let pg: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>
let legal: typeof import("../server/legal")
let book: typeof schema.books.$inferSelect
let acceptance: PublicationAcceptance

before(async () => {
  Object.assign(process.env, config)
  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused"
  legal = await import("../server/legal")
  // Rate limiter uses its explicit local fallback; no network database is used.
  delete process.env.DATABASE_URL
  pg = new PGlite()
  database = drizzle(pg, { schema })
  for (const file of readdirSync("migrations").filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    await pg.exec(readFileSync("migrations/" + file, "utf8"))
  }
  await pg.exec("INSERT INTO users (id,google_id,email,name) VALUES (1,'author','author@fixture.mx','Author'),(2,'other','other@fixture.mx','Other');")
  ;[book] = await database.insert(schema.books).values({ title: "Novela de un capítulo", author: "Author", authorId: 1, type: "book", status: "published", content: "Una versión original", chapters: [{ title: "Único", content: "Una versión original" }] }).returning()
  acceptance = { documentHash: legal.publicLegalBundle().hash, accepted: true, adultAndAuthorized: true, hasRights: true, origin: "original", evidence: "", choices: { offline: false, personalPrint: true, commercialPrint: false, audio: false, translation: false, collectibles: false } }
})
after(async () => {
  await pg?.close()
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test("faltan referencias e identidad: ningún interruptor comercial se abre por defecto", () => {
  assert.equal(legalConfiguration({}).identityReady, false)
  assert.equal(legalConfiguration({ ...config, LEGAL_OPERATOR_NAME: "TU-NOMBRE" }).publicationReady, false)
  assert.equal(legalConfiguration(config).commercialReady, true)
  assert.equal(legalConfiguration({ ...config, TINTA_LEGAL_REVIEW_REF: "true" }).commercialReady, false)
  assert.equal(legalConfiguration(config).gachaReady, false)
  assert.equal(legalConfiguration({ ...config, GACHA_LEGAL_REVIEW_REF: "fixture-sorteo", GACHA_AUTHORIZATION_REF: "fixture-autorizacion", GACHA_PROCESSOR_APPROVAL_REF: "fixture-procesador" }).gachaReady, true)
})

test("declaración expresa, procedencia y opciones estrictas; nunca casillas implícitas", () => {
  assert.equal(publicationAcceptanceSchema.safeParse({ ...acceptance, accepted: false }).success, false)
  assert.equal(publicationAcceptanceSchema.safeParse({ ...acceptance, choices: {} }).success, false)
  assert.equal(publicationAcceptanceSchema.safeParse({ ...acceptance, origin: "public_domain" }).success, false)
  assert.equal(publicationAcceptanceSchema.safeParse({ ...acceptance, hasRights: "true" }).success, false)
  assert.equal(privacyRequestSchema.safeParse({ email: "a@fixture.mx", type: "cancellation", description: "Solicito revisar mis borradores privados" }).success, true)
})

test("migración desde vacío, repetible y sin aceptar publicaciones históricas", async () => {
  const { validateExpectedSchema } = await import("../scripts/db-common.mjs")
  assert.deepEqual(await validateExpectedSchema({ query: (text: string, values: any[]) => pg.query(text, values) }), [])
  assert.equal((await database.select().from(schema.legalAcceptances)).length, 0)
  await pg.exec(readFileSync("migrations/0024_legal_foundation.sql", "utf8"))
  assert.equal(await legal.hasBookRight(book.id, book.revision, "personalPrint", database as any), false)
})

test("documento cambiado o permiso inválido revierte toda la transacción", async () => {
  await assert.rejects(database.transaction(async tx => {
    const [copy] = await tx.insert(schema.books).values({ title: "No debe persistir", author: "Author", authorId: 1, status: "published" }).returning()
    await legal.recordPublicationAcceptance(tx as any, copy, 1, { ...acceptance, documentHash: "0".repeat(64) })
  }), /condiciones cambiaron/)
  assert.equal((await database.select().from(schema.books)).length, 1)
  await assert.rejects(() => legal.recordPublicationAcceptance(database as any, book, 2, acceptance), /otra persona/)
})

test("comprobante íntegro, separado por versión y protegido frente a edición o borrado", async () => {
  await database.transaction(tx => legal.recordPublicationAcceptance(tx as any, book, 1, acceptance))
  const [receipt] = await database.select().from(schema.legalAcceptances)
  assert.equal(receipt.documentHash, legal.publicLegalBundle().hash)
  assert.deepEqual(receipt.documents, legal.publicLegalBundle().documents)
  assert.equal((receipt.declaration as any).authorShareBps, 9000)
  assert.equal(await legal.hasBookRight(book.id, book.revision, "personalPrint", database as any), true)
  assert.equal(await legal.hasBookRight(book.id, book.revision, "commercialPrint", database as any), false)
  assert.equal(await legal.hasBookRight(book.id, book.revision, "audio", database as any), false)
  await assert.rejects(() => pg.exec("UPDATE legal_acceptances SET document_version='forged'"), /append-only/)
  await assert.rejects(() => pg.exec("DELETE FROM legal_acceptances"), /append-only/)
  assert.notEqual(legal.publicationWorkHash({ ...book, content: "Cambiado" }), receipt.workHash)
  assert.notEqual(legal.publicationWorkHash({ ...book, authorId: 2 }), receipt.workHash)
  assert.equal(legal.publicationWorkHash({ ...book, commentsEnabled: false, revision: 99 }), receipt.workHash)
})

test("una preferencia no fabrica consentimiento y una modificación expresiva sí lo exige", async () => {
  await legal.recordPublicationAcceptance(database as any, { ...book, revision: 2, commentsEnabled: false }, 1, undefined, book)
  assert.equal((await database.select().from(schema.legalAcceptances)).length, 1)
  await assert.rejects(() => legal.recordPublicationAcceptance(database as any, { ...book, revision: 2, title: "Otra obra" }, 1, undefined, book), /confirma los derechos/)
})

test("el motor del sorteo rechaza sin habilitación antes de tocar dinero o una base externa", async () => {
  const { drawTicket } = await import("../server/gachaEngine")
  const result = await drawTicket(1)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 503)
})

test("solicitud pública persistida; admin de finanzas no ve datos de privacidad; folio no entrega datos", async () => {
  const { resolvePrincipalPermissions } = await import("../server/principalPermissions")
  const app = express()
  app.use(express.json())
  app.use((req: any, _res, next) => {
    const role = req.get("X-Fixture-Role")
    req.isAuthenticated = () => !!role
    if (role) { req.user = { id: role === "other" ? 2 : 1, email: "author@fixture.mx" }; resolvePrincipalPermissions(req.user, role, false) }
    next()
  })
  legal.registerLegalRoutes(app, database as any)
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ message: err.message }))
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    const reference = process.env.LEGAL_COMMERCIAL_REVIEW_REF
    delete process.env.LEGAL_COMMERCIAL_REVIEW_REF
    try {
      for (const path of ["/api/tokens/acquire", "/API/TOKENS/ACQUIRE/", "/api/wallet/buy/", "/api/cards/%31/buy", "/api/frames/1e0/buy"]) {
        const blocked = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        assert.equal(blocked.status, 503, path)
      }
    } finally { process.env.LEGAL_COMMERCIAL_REVIEW_REF = reference }
    for (const path of ["/api/books/1/audiobook/0/request", "/API/BOOKS/%31/AUDIOBOOK/0/REQUEST/", "/api/books/1e0/speech/0/publish/"]) {
      const blocked = await fetch(origin + path, { method: "POST", headers: { "X-Fixture-Role": "full" } })
      assert.equal(blocked.status, 428, path)
    }
    const sent = await fetch(origin + "/api/privacy/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "reader@fixture.mx", type: "cancellation", description: "Revisar conservación de mis borradores privados" }) })
    assert.equal(sent.status, 201)
    const receipt = await sent.json() as any
    assert.match(receipt.folio, /^[0-9a-f-]{36}$/)
    assert.equal(receipt.email, undefined)
    assert.equal((await database.select().from(schema.privacyRequests)).length, 1)
    assert.equal((await database.select().from(schema.privacyRequestEvents)).length, 1)
    assert.equal((await fetch(origin + "/api/admin/privacy/requests")).status, 401)
    assert.equal((await fetch(origin + "/api/admin/privacy/requests", { headers: { "X-Fixture-Role": "finance" } })).status, 403)
    assert.equal((await fetch(origin + "/api/admin/privacy/requests", { headers: { "X-Fixture-Role": "full" } })).status, 200)
    assert.equal((await fetch(origin + "/api/legal/receipts")).status, 401)
    const other = await fetch(origin + "/api/legal/receipts", { headers: { "X-Fixture-Role": "other" } })
    assert.deepEqual(await other.json(), [])
    assert.equal(permissionsForRole("legacy").includes("managePrivacy"), false)
    assert.equal((await fetch(origin + "/api/privacy/requests/" + receipt.folio)).status, 404)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
