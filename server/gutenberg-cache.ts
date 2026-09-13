// Process-local, bounded LRU and single-flight. Never stores failures or user data.
export class GutenbergBusyError extends Error {
  readonly status = 503
  constructor() { super("Gutenberg está ocupado. Vuelve a intentarlo en un momento.") }
}

export class GutenbergCache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>()
  private pending = new Map<string, Promise<T>>()
  private bytes = 0
  constructor(private readonly limits: { entries: number; bytes: number; pending: number; ttl: number }) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    for (const [oldKey, entry] of this.entries) {
      if (entry.expires <= Date.now()) this.remove(oldKey)
    }
    const entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key); this.entries.set(key, entry)
      return entry.value
    }
    const running = this.pending.get(key)
    if (running) return running
    if (this.pending.size >= this.limits.pending) throw new GutenbergBusyError()
    const task = Promise.resolve().then(load).then(value => {
      // Conservative UTF-16 estimate, including JSON field names and punctuation.
      const bytes = JSON.stringify(value).length * 2
      if (bytes <= this.limits.bytes) {
        while (this.entries.size >= this.limits.entries || this.bytes + bytes > this.limits.bytes) {
          this.remove(this.entries.keys().next().value!)
        }
        this.entries.set(key, { value, bytes, expires: Date.now() + this.limits.ttl })
        this.bytes += bytes
      }
      return value
    }).finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key) }
  }
}
