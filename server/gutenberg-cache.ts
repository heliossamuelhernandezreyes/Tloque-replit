// Process-local, bounded LRU and single-flight. Never stores failures or user data.
export class GutenbergBusyError extends Error {
  readonly status = 503
  constructor() { super("Gutenberg está ocupado. Vuelve a intentarlo en un momento.") }
}

export class GutenbergCache<T> {
  private entries = new Map<string, { value: T; fetchedAt: number; expires: number; bytes: number }>()
  private pending = new Map<string, Promise<{ value: T; fetchedAt: number; stale: boolean }>>()
  private bytes = 0
  constructor(private readonly limits: { entries: number; bytes: number; pending: number; ttl: number; staleTtl?: number }) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    return (await this.getWithStatus(key, load)).value
  }

  // Stale fallback is opt-in, bounded by the original timestamp and by the same
  // memory budget. A failed refresh never extends the lifetime of cached data.
  async getWithStatus(key: string, load: () => Promise<T>, allowStale?: (error: unknown) => boolean): Promise<{ value: T; fetchedAt: number; stale: boolean }> {
    const staleTtl = this.limits.staleTtl ?? 0
    for (const [oldKey, entry] of this.entries) {
      if (entry.expires + staleTtl <= Date.now()) this.remove(oldKey)
    }
    const entry = this.entries.get(key)
    if (entry && entry.expires > Date.now()) {
      this.entries.delete(key); this.entries.set(key, entry)
      return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false }
    }
    const running = this.pending.get(key)
    if (running) return running
    const recover = (error: unknown) => {
      if (entry && entry.expires + staleTtl > Date.now() && allowStale?.(error)) {
        return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true }
      }
      throw error
    }
    if (this.pending.size >= this.limits.pending) return recover(new GutenbergBusyError())
    const task = Promise.resolve().then(load).then(value => {
      // Conservative UTF-16 estimate, including JSON field names and punctuation.
      const bytes = JSON.stringify(value).length * 2
      const fetchedAt = Date.now()
      this.remove(key)
      if (bytes <= this.limits.bytes) {
        while (this.entries.size >= this.limits.entries || this.bytes + bytes > this.limits.bytes) {
          this.remove(this.entries.keys().next().value!)
        }
        this.entries.set(key, { value, bytes, fetchedAt, expires: fetchedAt + this.limits.ttl })
        this.bytes += bytes
      }
      return { value, fetchedAt, stale: false }
    }).catch(recover).finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key) }
  }
}
