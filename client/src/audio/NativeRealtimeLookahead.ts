export interface NativeRealtimeTask {
  readonly timeSeconds: number
  run(): void | Promise<unknown>
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

  constructor(tasks: readonly NativeRealtimeTask[]) {
    this.tasks = [...tasks].sort((a, b) => a.timeSeconds - b.timeSeconds)
  }

  get pendingCount() { return this.tasks.length - this.cursor }
  get complete() { return this.cursor >= this.tasks.length }

  pump(elapsedSeconds: number, lookaheadSeconds = NATIVE_REALTIME_LOOKAHEAD_SECONDS) {
    const horizon = Math.max(0, elapsedSeconds) + Math.max(0, lookaheadSeconds)
    const pending: Promise<unknown>[] = []
    while (this.cursor < this.tasks.length && this.tasks[this.cursor].timeSeconds <= horizon) {
      const task = this.tasks[this.cursor++]
      try {
        const result = task.run()
        if (result instanceof Promise) pending.push(result)
      } catch (error) {
        pending.push(Promise.reject(error))
      }
    }
    return pending
  }
}
