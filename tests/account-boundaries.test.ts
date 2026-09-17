import test from "node:test"
import assert from "node:assert/strict"
import { AccountContext, AccountChangedError } from "../client/src/lib/account-context"
import { ACCOUNT_HEADER, accountContextError } from "../shared/account-context"
import { administrativeCapability, permissionsForRole } from "../shared/admin-permissions"
import { hasCapability, isAdmin, resolvePrincipalPermissions } from "../server/principalPermissions"
import { api } from "../shared/routes"

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}
function page(local = new MemoryStorage()) {
  const session = new MemoryStorage()
  const context = new AccountContext(() => local, () => session)
  return { context, local, session, storage: context.storage() }
}

test("otra cuenta no hereda progreso, biblioteca ni borradores; lo antiguo permanece sin asignar", () => {
  const a = page()
  a.local.setItem("novareads_drafts", "unassigned historical draft")
  assert.equal(a.storage.getItem("novareads_drafts"), null)
  a.context.activate(1)
  for (const key of ["novareads_streak", "reading_chapter_71", "novareads_saved", "novareads_drafts"]) {
    a.storage.setItem(key, "private A")
  }
  const b = page(a.local)
  b.context.activate(2)
  assert.equal(b.storage.length, 0)
  assert.equal(b.storage.getItem("novareads_drafts"), null)
  assert.equal(a.storage.getItem("novareads_drafts"), null)
  assert.throws(() => a.storage.setItem("novareads_saved", "late write"), AccountChangedError)
  assert.equal(a.local.getItem("novareads_drafts"), "unassigned historical draft")
  const aAgain = page(a.local)
  aAgain.context.activate(1)
  assert.equal(aAgain.storage.getItem("novareads_drafts"), "private A")
  assert.equal(aAgain.storage.length, 4)
})

test("salir conserva el borrador propio y no permite reutilizar callbacks con otra identidad", () => {
  const { context, storage, local } = page()
  context.activate(9)
  storage.setItem("novareads_drafts", "pending manuscript")
  context.end()
  assert.equal(storage.getItem("novareads_drafts"), null)
  assert.throws(() => context.activate(10), AccountChangedError)
  const next = page(local)
  next.context.activate(9)
  assert.equal(next.storage.getItem("novareads_drafts"), "pending manuscript")
})

test("una verificación de sesión tardía no deshace el cambio realizado en otra pestaña", () => {
  const a = page()
  a.context.activate(1)
  const observed = a.context.marker()
  page(a.local).context.activate(2)
  assert.throws(() => a.context.activate(1, observed), AccountChangedError)
  assert.equal(a.context.marker(), "2")
})

test("cabecera de cuenta, cancelación y respuesta tardía mantienen el propietario original", async () => {
  const a = page()
  a.context.activate(1)
  let resolve!: (value: Response) => void
  let received: Headers | undefined
  let signal: AbortSignal | null | undefined
  const pending = a.context.request("/api/sync/library", { method: "PUT" }, async (_url, init) => {
    received = new Headers(init?.headers); signal = init?.signal
    return new Promise<Response>(done => { resolve = done })
  })
  assert.equal(received?.get(ACCOUNT_HEADER), "1")
  page(a.local).context.activate(2)
  a.context.checkMarker()
  assert.equal(signal?.aborted, true)
  resolve(Response.json({ private: "account A" }))
  await assert.rejects(pending, AccountChangedError)
})

test("una respuesta recibida antes del cambio tampoco puede leerse después", async () => {
  const a = page()
  a.context.activate(1)
  const response = await a.context.request("/api/books/mine", {}, async () => Response.json({ draft: "A" }))
  page(a.local).context.activate(2)
  await assert.rejects(() => response.json(), AccountChangedError)
})

test("cerrar sesión pausa la cola de red, conserva escritura local y permite reintentar si falla", async () => {
  const a = page()
  a.context.activate(1)
  a.context.pauseRequests()
  a.storage.setItem("draft", "latest text")
  await assert.rejects(() => a.context.request("/api/sync/state"), AccountChangedError)
  a.context.resumeRequests()
  const response = await a.context.request("/api/sync/state", {}, async () => Response.json({ ok: true }))
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(a.storage.getItem("draft"), "latest text")
})

test("sin almacenamiento disponible se conserva el acceso online y el vínculo de cuenta", async () => {
  const unavailable = new MemoryStorage()
  unavailable.setItem = () => { throw new Error("QuotaExceededError") }
  const a = page(unavailable)
  a.context.activate(1)
  const result = await a.context.request("/api/books", {}, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get(ACCOUNT_HEADER), "1")
    return Response.json([])
  })
  assert.deepEqual(await result.json(), [])
})

test("el servidor distingue cuenta equivocada y contexto ausente; no confunde el encabezado con autorización", () => {
  assert.equal(accountContextError("1", 2, true), "ACCOUNT_CHANGED")
  assert.equal(accountContextError("1", null, false), "ACCOUNT_CHANGED")
  assert.equal(accountContextError(undefined, 2, true), "ACCOUNT_CONTEXT_REQUIRED")
  assert.equal(accountContextError("2", 2, true), null)
  assert.equal(accountContextError(undefined, null, true), null)
})

test("roles limitados no heredan permisos por campos falsificados ni roles desconocidos", () => {
  const user = { id: 3, isAdmin: true, role: "full" }
  assert.equal(isAdmin(user), false)
  resolvePrincipalPermissions(user, "visual", false)
  assert.equal(hasCapability(user, "manageFrames"), true)
  assert.equal(hasCapability(user, "manageFinance"), false)
  assert.equal(hasCapability(user, "manageCatalog"), false)
  assert.equal(hasCapability(user, "manageAdmins"), false)
  assert.deepEqual(permissionsForRole("unknown"), [])
  assert.equal(administrativeCapability("/api/admin/unknown"), null)
  resolvePrincipalPermissions(user, undefined, false)
  assert.equal(isAdmin(user), false)
  resolvePrincipalPermissions(user, undefined, true)
  assert.equal(hasCapability(user, "manageAdmins"), true)
})

test("las actualizaciones de manuscrito requieren una revisión canónica válida", () => {
  for (const input of [{ title: "change" }, { expectedRevision: 0 }, { expectedRevision: null }]) {
    assert.equal(api.books.update.input.safeParse(input).success, false)
  }
  assert.equal(api.books.update.input.safeParse({ title: "change", expectedRevision: 3 }).success, true)
})
