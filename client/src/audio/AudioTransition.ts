/** A UI gain envelope whose elapsed time explicitly excludes a user pause. */
export class AudioTransition {
  private raf = 0
  private elapsed = 0
  private last = 0
  private duration = 1
  private paused = false
  private update: ((progress: number) => void) | null = null
  private finish: (() => void) | null = null
  get active() { return this.update !== null }
  start(seconds: number, update: (progress: number) => void, finish: () => void, paused = false) {
    this.stop()
    this.duration = Math.max(1, seconds * 1_000)
    this.update = update; this.finish = finish; this.paused = paused
    update(0)
    if (!paused) this.resume()
  }
  pause() { this.paused = true; cancelAnimationFrame(this.raf) }
  resume() {
    if (!this.update) return
    this.paused = false; this.last = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.frame)
  }
  stop() { cancelAnimationFrame(this.raf); this.update = null; this.finish = null; this.elapsed = 0 }
  private frame = (now: number) => {
    if (this.paused || !this.update) return
    this.elapsed += Math.max(0, now - this.last); this.last = now
    const progress = Math.min(1, this.elapsed / this.duration)
    this.update(progress)
    if (progress < 1) this.raf = requestAnimationFrame(this.frame)
    else { const finish = this.finish; this.stop(); finish?.() }
  }
}

export function waitForMediaReady(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Playback cancelled', 'AbortError'))
  if (audio.readyState >= 3) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); audio.removeEventListener('canplay', ready); audio.removeEventListener('error', failed); signal.removeEventListener('abort', aborted) }
    const ready = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(new Error('Audio unavailable')) }
    const aborted = () => { cleanup(); reject(new DOMException('Playback cancelled', 'AbortError')) }
    const timer = setTimeout(failed, 30_000)
    audio.addEventListener('canplay', ready, {once: true}); audio.addEventListener('error', failed, {once: true})
    signal.addEventListener('abort', aborted, {once: true})
  })
}
