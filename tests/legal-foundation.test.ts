import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { once } from "node:events"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import express from "express"
import { legalConfiguration } from "../server/legalConfig"
import { publicationAcceptanceSchema, privacyRequestSchema, tokenRightsFailure, type PublicationAcceptance } from "../shared/legal"
import * as schema from "../shared/schema"
import { permissionsForRole } from "../shared/admin-permissions"
import { eq, sql } from "drizzle-orm"

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
  acceptance = { documentHash: legal.publicLegalBundle().hash, accepted: true, adultAndAuthorized: true, hasRights: true, origin: "original", evidence: "", choices: { offline: false, personalPrint: true, commercialPrint: false, audio: false, translation: false, collectibles: false, monetization: false, permanentDigital: false } }
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
  await pg.exec("ALTER TABLE licensed_editions DROP CONSTRAINT licensed_editions_contract_check")
  await pg.exec(readFileSync("migrations/0025_acquired_editions.sql", "utf8"))
  assert.deepEqual(await validateExpectedSchema({ query: (text: string, values: any[]) => pg.query(text, values) }), [], "also upgrades a table created by db:push without SQL checks")
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
    const [request] = await database.select().from(schema.privacyRequests)
    const changed = await fetch(origin + `/api/admin/privacy/requests/${request.id}`, { method: "PATCH", headers: { "X-Fixture-Role": "full", "Content-Type": "application/json" }, body: JSON.stringify({ status: "verification", note: "Se pidió aclarar el alcance por el canal verificado" }) })
    assert.equal(changed.status, 200)
    assert.equal((await fetch(origin + `/api/admin/privacy/requests/${request.id}/events`, { headers: { "X-Fixture-Role": "finance" } })).status, 403)
    const events = await fetch(origin + `/api/admin/privacy/requests/${request.id}/events`, { headers: { "X-Fixture-Role": "full" } })
    assert.deepEqual((await events.json() as any[]).map(event => event.status), ["received", "verification"])
    assert.equal((await fetch(origin + "/api/legal/receipts")).status, 401)
    const other = await fetch(origin + "/api/legal/receipts", { headers: { "X-Fixture-Role": "other" } })
    assert.deepEqual(await other.json(), [])
    assert.equal(permissionsForRole("legacy").includes("managePrivacy"), false)
    assert.equal((await fetch(origin + "/api/privacy/requests/" + receipt.folio)).status, 404)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test("offline y tarjetas: permiso por edición, apoyo comprobado y conservación de entregas previas", async () => {
  const { grantAuthorizedSupportCards } = await import("../server/collectibleRights")
  await assert.rejects(() => legal.offlineEdition(book, 2, database as any), /no ha autorizado/)
  assert.equal((await legal.offlineEdition(book, 1, database as any)).authorId, 1, "el autor puede descargar su propio trabajo")
  const [edition] = await database.insert(schema.books).values({ title: "Edición autorizada", author: "Author", authorId: 1, status: "published", content: "Lectura autorizada" }).returning()
  await legal.recordPublicationAcceptance(database as any, edition, 1, { ...acceptance, choices: { ...acceptance.choices, offline: true, collectibles: true } })
  const [deniedCard] = await database.insert(schema.bookCards).values({ bookId: book.id, authorId: 1, name: "Sin licencia", unlock: "support" }).returning()
  const [allowedCard] = await database.insert(schema.bookCards).values({ bookId: edition.id, authorId: 1, name: "Con licencia", unlock: "support" }).returning()
  await grantAuthorizedSupportCards(2, [book.id, edition.id], database as any)
  assert.equal((await database.select().from(schema.userCards)).length, 0, "un permiso no inventa un apoyo")
  await database.insert(schema.unlockedBooks).values([{ userId: 2, bookId: book.id, source: "support" }, { userId: 2, bookId: edition.id, source: "support" }])
  await grantAuthorizedSupportCards(2, [book.id, edition.id], database as any)
  const acquired = await database.select().from(schema.userCards)
  assert.deepEqual(acquired.map(row => row.cardId), [allowedCard.id])
  assert.notEqual(acquired[0].cardId, deniedCard.id)
  assert.equal((await legal.offlineEdition(edition, 2, database as any)).content, "Lectura autorizada")
  await database.update(schema.books).set({ content: "Una edición diferente", revision: 2 }).where(eq(schema.books.id, edition.id))
  const [changed] = await database.select().from(schema.books).where(eq(schema.books.id, edition.id))
  await database.insert(schema.bookCards).values({ bookId: edition.id, authorId: 1, name: "Nueva, sin permiso de versión", unlock: "support" })
  await grantAuthorizedSupportCards(2, [edition.id], database as any)
  assert.equal((await database.select().from(schema.userCards)).length, 1, "no entrega nuevas tarjetas ni borra la adquirida")
  await assert.rejects(() => legal.offlineEdition(changed, 2, database as any), /no ha autorizado/)
  assert.equal((await legal.offlineEdition(edition, 2, database as any)).content, "Lectura autorizada", "la edición histórica con permiso conserva su autorización")
})

test("el inventario de retención funciona en solo lectura y no expone textos ni contactos", async () => {
  const { retentionInventory } = await import("../scripts/retention-inventory.mjs")
  await pg.exec("BEGIN READ ONLY")
  try {
    const report = await retentionInventory({ query: (text: string, values: any[]) => pg.query(text, values) }, 1)
    assert.equal(report.executedDeletions, 0)
    assert.equal(report.mode, "read-only")
    assert.equal(report.accountClosed, false)
    assert.ok(report.counts.some((row: any) => row.table === "books" && row.rows === 2))
    assert.ok(!JSON.stringify(report).includes("author@fixture.mx"))
    assert.ok(!JSON.stringify(report).includes("Una versión original"))
    assert.ok(report.limits.some((line: string) => line.includes("backups")))
  } finally { await pg.exec("ROLLBACK") }
  assert.equal((await database.select().from(schema.books)).length, 2)
})

test("el sorteo excluye obras sin permiso y nunca cobra cuando no queda stock autorizado", async () => {
  const { drawTicket } = await import("../server/gachaEngine")
  const gates = { GACHA_LEGAL_REVIEW_REF: "fixture-dictamen", GACHA_AUTHORIZATION_REF: "fixture-expediente", GACHA_PROCESSOR_APPROVAL_REF: "fixture-procesador" }
  const prior = Object.fromEntries(Object.keys(gates).map(key => [key, process.env[key]]))
  Object.assign(process.env, gates)
  try {
    await database.update(schema.gachaConfig).set({ enabled: true, ticketPrice: 25, splitDirect: 10, splitPool: 10, splitHouse: 5, poolBalance: 1000 }).where(eq(schema.gachaConfig.id, 1))
    await database.update(schema.bookCards).set({ inGachaPool: true })
    const before = (await database.select().from(schema.walletLedger)).length
    const empty = await drawTicket(2, database as any)
    assert.equal(empty.ok, false)
    if (!empty.ok) assert.equal(empty.code, 404)
    assert.equal((await database.select().from(schema.walletLedger)).length, before)
    const [authorized] = await database.select().from(schema.books).where(eq(schema.books.title, "Edición autorizada"))
    await database.update(schema.books).set({ content: "Lectura autorizada", revision: 3 }).where(eq(schema.books.id, authorized.id))
    await database.insert(schema.walletLedger).values({ userId: 2, currency: "tinta", delta: 100, reason: "fixture" })
    const drawn = await drawTicket(2, database as any)
    assert.equal(drawn.ok, true)
    if (drawn.ok) assert.equal(drawn.result.book.id, authorized.id, "solo participa la obra con autorización exacta")
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("un permiso histórico no autoriza implícitamente monetización ni acceso permanente", () => {
  const legacy: any = { ...acceptance, choices: { ...acceptance.choices } }
  delete legacy.choices.monetization; delete legacy.choices.permanentDigital
  const parsed = publicationAcceptanceSchema.parse(legacy)
  assert.equal(parsed.choices.monetization, false)
  assert.match(tokenRightsFailure(parsed.choices, "support")!, /monetización/)
  assert.match(tokenRightsFailure({ monetization: true, permanentDigital: true, offline: false }, "sale")!, /sin conexión/)
  assert.equal(tokenRightsFailure({ monetization: true, permanentDigital: true, offline: true, commercialPrint: true }, "sale"), null)
})

test("la edición pagada conserva texto y autorización; primera cuenta y contrato son inmutables", async () => {
  const { freezeLicensedEdition, purchasedEditions, tokenEdition } = await import("../server/tokenEditions")
  await pg.exec("INSERT INTO users(id,google_id,email,name) VALUES(3,'reader3','reader3@fixture.mx','Reader3')")
  const [work] = await database.insert(schema.books).values({ title: "Edición permanente", author: "Author", authorId: 1, status: "published", content: "TEXTO ADQUIRIDO" }).returning()
  await database.insert(schema.bookRevisions).values({ bookId: work.id, revision: work.revision, snapshot: work, changeType: "publish", createdBy: 1 })
  const choices = { ...acceptance.choices, offline: true, monetization: true, permanentDigital: true, commercialPrint: true }
  await legal.recordPublicationAcceptance(database as any, work, 1, { ...acceptance, choices })
  const consent = await legal.bookAcceptance(work, database as any)
  const edition = await database.transaction(tx => freezeLicensedEdition(tx, work, consent!.receipt.id, choices))
  assert.equal((await freezeLicensedEdition(database, work, consent!.receipt.id, choices)).id, edition.id)
  const [support] = await database.insert(schema.bookTokens).values({ kind: "support", bookId: work.id, ownerUserId: 2, editionId: edition.id }).returning()
  const [sale] = await database.insert(schema.bookTokens).values({ kind: "sale", bookId: work.id, ownerUserId: 2, editionId: edition.id }).returning()
  const [copy] = await database.insert(schema.printCopies).values({ tokenId: sale.id, folio: "TLQ-EDTN-0001", claimKey: "TEST-KEY1", claimedByUserId: 3, claimedAt: new Date() }).returning()
  await database.update(schema.books).set({ content: "BORRADOR PRIVADO POSTERIOR", status: "draft", revision: 2 }).where(eq(schema.books.id, work.id))
  assert.equal((await tokenEdition(support, database))!.content, "TEXTO ADQUIRIDO")
  assert.equal((await tokenEdition({ bookId: work.id }, database))!.content, "TEXTO ADQUIRIDO", "historic printing uses a public revision, never the current private draft")
  const [neverPublished] = await database.insert(schema.books).values({ title: "Borrador sin edición pública", author: "Author", authorId: 1, status: "draft", content: "TEXTO PRIVADO" }).returning()
  assert.equal(await tokenEdition({ bookId: neverPublished.id }, database), undefined, "missing public history cannot authorize exposing a manuscript")
  assert.equal((await purchasedEditions(2, [work.id], database)).get(work.id)!.snapshot.content, "TEXTO ADQUIRIDO")
  assert.equal((await purchasedEditions(1, [work.id], database)).size, 0)
  assert.equal((await legal.offlineEdition(edition.snapshot, 3, database as any)).content, "TEXTO ADQUIRIDO")
  await database.update(schema.bookTokens).set({ licenseStatus: "revoked" }).where(eq(schema.bookTokens.id, sale.id))
  assert.equal((await purchasedEditions(3, [work.id], database)).get(work.id)!.id, edition.id, "a reader retains their digital claim after a seller refund")
  await assert.rejects(() => pg.query("UPDATE print_copies SET claimed_by_user_id=2 WHERE id=$1", [copy.id]), /first account/)
  await assert.rejects(() => pg.query("UPDATE print_copies SET claimed_by_user_id=NULL WHERE id=$1", [copy.id]), /first account/)
  await database.update(schema.printCopies).set({ saleStatus: "returned" }).where(eq(schema.printCopies.id, copy.id))
  await assert.rejects(() => pg.query("UPDATE licensed_editions SET snapshot='{}' WHERE id=$1", [edition.id]), /append-only/)
  const [order] = await database.insert(schema.tokenOrders).values({ userId: 2, bookId: work.id, kind: "support", editionId: edition.id, purchaseTerms: { accepted: true, documentHash: acceptance.documentHash } }).returning()
  await assert.rejects(() => pg.query("UPDATE token_orders SET purchase_terms='{}' WHERE id=$1", [order.id]), /immutable/)
})

test("avisos y contraavisos aislados por rol y autor; bloqueo persistente y restauración con evidencia", async () => {
  const { registerRightsRoutes, commercialApproval } = await import("../server/rightsCases")
  const { resolvePrincipalPermissions } = await import("../server/principalPermissions")
  const [work] = await database.insert(schema.books).values({ title: "Reclamación probada", author: "Author", authorId: 1, status: "published", content: "VERSION PARA REVISAR" }).returning()
  await legal.recordPublicationAcceptance(database as any, work, 1, { ...acceptance, choices: { ...acceptance.choices, offline: true, monetization: true, permanentDigital: true, commercialPrint: true } })
  const consent = await legal.bookAcceptance(work, database as any)
  assert.equal(await commercialApproval(work.id, consent!.receipt.id, legal.publicationWorkHash(work), database), false)
  const app = express(); app.use(express.json())
  app.use((req: any, _res, next) => {
    const role = req.get("X-Fixture-Role"); req.isAuthenticated = () => !!role
    if (role) { req.user = { id: role === "other" ? 2 : 1 }; resolvePrincipalPermissions(req.user, role, false) }
    next()
  })
  registerRightsRoutes(app, database)
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ message: err.message }))
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening")
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  const request = async (path: string, method = "GET", body?: any, role?: string) => {
    const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(role ? { "X-Fixture-Role": role } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() as any }
  }
  try {
    const approval = { bookId: work.id, revision: work.revision, action: "approve", agreementRef: "fixture-signed-commercial-agreement", evidenceRef: "fixture-holder-evidence", confirmedRightsAndAgreement: true }
    assert.equal((await request("/api/admin/rights/approvals", "POST", approval, "finance")).status, 403)
    assert.equal((await request("/api/admin/rights/approvals", "POST", approval, "full")).status, 201)
    assert.equal(await commercialApproval(work.id, consent!.receipt.id, legal.publicationWorkHash(work), database), true)
    const sent = await request("/api/rights/notices", "POST", { bookId: work.id, name: "Titular simulado", email: "claimant@fixture.mx", work: "La edición identificada", location: "/book/" + work.id, rightsBasis: "Soy titular de los derechos invocados en este caso simulado.", goodFaith: true })
    assert.equal(sent.status, 201)
    assert.equal(sent.body.email, undefined)
    assert.equal((await request("/api/admin/rights", "GET", undefined, "finance")).status, 403)
    const listed = await request("/api/admin/rights", "GET", undefined, "full"), row = listed.body.cases[0]
    assert.equal(row.claimant_email, "claimant@fixture.mx")
    const decide = (action: string, expectedStatus: string, extra: any = {}) => request(`/api/admin/rights/cases/${row.id}`, "PATCH", { action, expectedStatus, note: "Actuación documentada en expediente simulado", ...extra }, "full")
    assert.equal((await decide("removed", "received")).status, 200)
    const [held] = await database.select().from(schema.books).where(eq(schema.books.id, work.id))
    assert.equal(held.rightsHold, true)
    assert.equal(await legal.hasBookRight(held.id, held.revision, "offline", database as any), false)
    await assert.rejects(() => database.transaction(async tx => {
      const [duplicate] = await tx.insert(schema.books).values({ title: "Otro título para el mismo texto", author: "Author", authorId: 1, status: "published", content: work.content, chapters: work.chapters }).returning()
      await legal.recordPublicationAcceptance(tx as any, duplicate, 1, acceptance)
    }), /coincide con una obra retirada/)
    await database.update(schema.books).set({ status: "published" }).where(eq(schema.books.id, held.id))
    const [republished] = await database.select().from(schema.books).where(eq(schema.books.id, held.id))
    assert.equal(republished.rightsHold, true, "a catalogue status edit cannot release a rights hold")
    const counter = { publicId: sent.body.folio, authorized: true, evidence: "Aporto un permiso suficiente para esta edición simulada." }
    assert.equal((await request("/api/rights/counter-notices", "POST", counter, "other")).status, 404)
    assert.equal((await request("/api/rights/counter-notices", "POST", counter, "full")).status, 201)
    assert.equal((await decide("restored", "counter_received")).status, 409)
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
    assert.equal((await decide("counter_notified", "counter_received", { reference: "fixture-delivery-record", notifiedAt: new Date(Date.now() - 1000).toISOString(), deadlineAt: future })).status, 200)
    assert.equal((await decide("restored", "counter_notified")).status, 409)
    await database.execute(sql`update copyright_cases set deadline_at=now()-interval '1 day' where id=${row.id}`)
    assert.equal((await decide("restored", "counter_notified")).status, 200)
    assert.equal((await database.select().from(schema.books).where(eq(schema.books.id, held.id)))[0].rightsHold, false)
    assert.equal((await decide("removed", "received")).status, 409)
    await assert.rejects(() => pg.query("delete from copyright_case_events where case_id=$1", [row.id]), /append-only/)
    assert.equal((await request("/api/rights/cases/mine", "GET", undefined, "other")).body.length, 0)
    const own = await request("/api/rights/cases/mine", "GET", undefined, "full")
    assert.equal(own.body[0].claimant_email, undefined)
    assert.equal(own.body[0].work_description, "La edición identificada")
    const additional: any[] = []
    for (let n = 0; n < 2; n++) {
      const fresh = await request("/api/rights/notices", "POST", { bookId: work.id, name: "Titular simulado", email: "claimant@fixture.mx", work: "Otra reclamación de prueba", location: "/book/" + work.id, rightsBasis: "Derecho invocado en otra reclamación simulada.", goodFaith: true })
      assert.equal(fresh.status, 201)
      const all = await request("/api/admin/rights", "GET", undefined, "full")
      const item = all.body.cases.find((entry: any) => entry.public_id === fresh.body.folio)
      additional.push(item)
      const removed = await request(`/api/admin/rights/cases/${item.id}`, "PATCH", { action: "removed", expectedStatus: "received", note: "Se verifica el alcance del segundo aviso simulado." }, "full")
      assert.equal(removed.status, 200)
    }
    for (let n = 0; n < 2; n++) {
      assert.equal((await request(`/api/admin/rights/cases/${additional[n].id}`, "PATCH", { action: "restored", expectedStatus: "removed", note: "El reclamante retiró el aviso según constancia revisada.", reference: "fixture-withdrawal-proof", resolutionConfirmed: true }, "full")).status, 200)
      const [current] = await database.select().from(schema.books).where(eq(schema.books.id, work.id))
      assert.equal(current.rightsHold, n === 0, "another unresolved case keeps the hold")
      if (n === 1) assert.equal(current.status, "published", "the last case restores the original status")
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
