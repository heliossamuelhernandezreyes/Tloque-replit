export interface NativeRealtimeTask {
  readonly timeSeconds: number
  /** Offset of the current musical cycle; zero for a one-shot timeline. */
  run(cycleOffsetSeconds?: number): void | Promise<unknown>
}

export const NATIVE_REALTIME_LOOKAHEAD_SECONDS = 6
export const NATIVE_REALTIME_TICK_MS = 500

/**
 * Schedules lightweight score tasks incrementally. The audio clock remains the
 * source of truth, so suspending an AudioContext naturally freezes progression.
 */
export class NativeRealtimeLookahead {
  private readonly tasks: NativeRealtimeTask[]
  private cursor = 0
  private cycle = 0

  constructor(tasks: readonly NativeRealtimeTask[], private readonly loopSeconds = 0) {
    this.tasks = [...tasks].sort((a, b) => a.timeSeconds - b.timeSeconds)
  }

  get pendingCount() { return this.tasks.length - this.cursor }
  get complete() { return this.loopSeconds <= 0 && this.cursor >= this.tasks.length }

  pump(elapsedSeconds: number, lookaheadSeconds = NATIVE_REALTIME_LOOKAHEAD_SECONDS) {
    const horizon = Math.max(0, elapsedSeconds) + Math.max(0, lookaheadSeconds)
    const pending: Promise<unknown>[] = []
    if (!this.tasks.length) return pending
    while (true) {
      if (this.cursor >= this.tasks.length) {
        if (this.loopSeconds <= 0) break
        this.cursor = 0
        this.cycle += 1
      }
      const task = this.tasks[this.cursor]
      const cycleOffset = this.loopSeconds > 0 ? this.cycle * this.loopSeconds : 0
      const scheduledAt = cycleOffset + task.timeSeconds
      if (scheduledAt > horizon) break
      this.cursor += 1
      // A throttled browser must not burst every missed note on recovery. The
      // audio clock remains authoritative; stale attacks are deliberately skipped.
      if (scheduledAt < Math.max(0, elapsedSeconds - 0.1)) continue
      try {
        const result = task.run(cycleOffset)
        if (result instanceof Promise) pending.push(result)
      } catch (error) {
        pending.push(Promise.reject(error))
      }
    }
    return pending
  }
}
