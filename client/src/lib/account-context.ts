import { ACCOUNT_HEADER, ACCOUNT_MARKER, accountDatabaseName } from "../../../shared/account-context"

type StorageSource = () => Storage
export class AccountChangedError extends Error {
  constructor() { super("La sesión cambió. Recarga para continuar con la cuenta actual."); this.name = "AccountChangedError" }
}

/** One identity per page lifetime. A switch locks this page instead of moving
 * old callbacks, drafts or queued requests into the next account's namespace. */
export class AccountContext {
  private owner: string | null = null
  private locked = false
  private requestsPaused = false
  private tracksMarker = false
  private abort = new AbortController()
  constructor(
    private local: StorageSource,
    private session: StorageSource,
    private changed: () => void = () => {},
  ) {}

  marker(): string | null { try { return this.local().getItem(ACCOUNT_MARKER) } catch { return null } }
  get id(): string | null { return this.locked ? null : this.owner }
  get signal(): AbortSignal { return this.abort.signal }
  get databaseName(): string { return accountDatabaseName(this.requireId()) }
  requireId(): string {
    this.checkMarker()
    if (!this.id) throw new AccountChangedError()
    return this.id
  }
  assertCurrent(id: string): void {
    if (this.requireId() !== id) throw new AccountChangedError()
  }
  activate(id: number | null, observedMarker = this.marker()): void {
    if (this.marker() !== observedMarker) { this.lock(); throw new AccountChangedError() }
    if (id === null) {
      if (this.owner) this.lock()
      try { this.local().removeItem(ACCOUNT_MARKER) } catch { /* private browsing */ }
      return
    }
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Identidad de cuenta inválida")
    if (this.locked || (this.owner !== null && this.owner !== String(id))) {
      this.lock(); throw new AccountChangedError()
    }
    this.owner = String(id)
    try {
      this.local().setItem(ACCOUNT_MARKER, this.owner)
      this.tracksMarker = true
    } catch { this.tracksMarker = false } // Quota/storage failures do not prevent online use.
  }
  checkMarker(): void {
    if (this.locked || this.owner === null || !this.tracksMarker) return
    let marker: string | null
    try { marker = this.local().getItem(ACCOUNT_MARKER) } catch { return }
    if (marker !== this.owner) this.lock()
  }
  lock(): void {
    if (this.locked) return
    this.locked = true
    this.abort.abort()
    this.changed()
  }
  pauseRequests(): void {
    this.requestsPaused = true
    this.abort.abort()
  }
  resumeRequests(): void {
    this.checkMarker()
    if (this.locked) return
    this.abort = new AbortController()
    this.requestsPaused = false
  }
  end(): void {
    try {
      if (this.marker() === this.owner) this.local().removeItem(ACCOUNT_MARKER)
    } finally { this.lock() }
  }

  storage(kind: "local" | "session" = "local"): Storage & { keys(): string[] } {
    const source = kind === "local" ? this.local : this.session
    const prefix = () => "tloque.account.v1:" + this.requireId() + ":" + kind + ":"
    const keys = (): string[] => {
      if (!this.id) return []
      try {
        const p = prefix(), store = source(), result: string[] = []
        for (let index = 0; index < store.length; index++) {
          const key = store.key(index)
          if (key?.startsWith(p)) result.push(key.slice(p.length))
        }
        return result
      } catch { return [] }
    }
    return {
      getItem: key => {
        if (!this.id) return null
        try { return source().getItem(prefix() + key) } catch { return null }
      },
      setItem: (key, value) => source().setItem(prefix() + key, String(value)),
      removeItem: key => { if (this.id) source().removeItem(prefix() + key) },
      clear: () => { for (const key of keys()) source().removeItem(prefix() + key) },
      key: index => keys()[index] ?? null,
      get length() { return keys().length },
      keys,
    }
  }

  async request(input: RequestInfo | URL, init: RequestInit = {}, fetchImpl: typeof fetch = globalThis.fetch): Promise<Response> {
    if (this.requestsPaused) throw new AccountChangedError()
    const id = this.requireId()
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(ACCOUNT_HEADER, id)
    const controller = new AbortController()
    const signals = [this.signal, init.signal ?? (input instanceof Request ? input.signal : null)].filter(Boolean) as AbortSignal[]
    const cancel = () => controller.abort()
    for (const signal of signals) {
      if (signal.aborted) cancel()
      else signal.addEventListener("abort", cancel, { once: true })
    }
    try {
      const response = await fetchImpl(input, { ...init, headers, signal: controller.signal })
      this.assertCurrent(id)
      if (response.headers.get("X-Tloque-Session") === "changed") {
        this.lock()
        throw new AccountChangedError()
      }
      const context = this
      const protect = (result: Response): Response => new Proxy(result, {
        get(target, property) {
          if (property === "clone") return () => protect(target.clone())
          if (["json", "text", "blob", "arrayBuffer", "formData"].includes(String(property))) {
            return async () => {
              context.assertCurrent(id)
              const value = await (target as any)[property]()
              context.assertCurrent(id)
              return value
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      return protect(response)
    } finally {
      for (const signal of signals) signal.removeEventListener("abort", cancel)
    }
  }
}

export const accountContext = new AccountContext(
  () => globalThis.localStorage,
  () => globalThis.sessionStorage,
  () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("tloque:account-changed"))
      // Old component closures never become callbacks belonging to a new user.
      window.location.reload()
    }
  },
)
if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key === ACCOUNT_MARKER || event.key === null) accountContext.checkMarker()
  })
}
export const accountStorage = accountContext.storage()
export const accountSessionStorage = accountContext.storage("session")

export const accountFetch: typeof fetch = (input, init) => {
  const raw = input instanceof Request ? input.url : String(input)
  const origin = typeof location === "undefined" ? "https://tloque.local" : location.origin
  const url = new URL(raw, origin)
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) return globalThis.fetch(input, init)
  return accountContext.request(input, init)
}
