import { MusicEngine, type MusicCue } from '../client/src/audio/MusicEngine'
import { HybridMusicEngine } from '../client/src/audio/HybridMusicEngine'
import { AdaptiveLayerMusicEngine } from '../client/src/audio/AdaptiveLayerMusicEngine'
import { DEFAULT_PROCEDURAL_RECIPE } from '../shared/audio'
import * as Tone from 'tone'

// Audit-only reproductions. A confirmed result means the defect is present.
const NativeAudio = window.Audio
const media: HTMLAudioElement[] = []
;(window as any).Audio = function (url?: string) {
  const audio = new NativeAudio(url)
  media.push(audio)
  return audio
}
;(window as any).Audio.prototype = NativeAudio.prototype
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const cue = (id: number, changes: Partial<MusicCue> = {}): MusicCue => ({
  id, title: 'Synthetic audit fixture', sourceType: 'stream', url: '/tone.wav',
  volume: 1, crossfadeSeconds: .25, loop: true, ...changes,
})
const results: any[] = []
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function probe(id: string, run: () => Promise<any>) {
  media.length = 0
  try { results.push({ id, confirmed: true, ...await run() }) }
  catch (error) { results.push({ id, confirmed: false, error: String((error as Error).stack) }) }
  finally { for (const audio of media) { audio.pause(); audio.removeAttribute('src'); audio.load() } }
}
async function transition() {
  const states: string[] = [], engine = new MusicEngine(state => states.push(state))
  await engine.play(cue(1)); await delay(350)
  await engine.play(cue(2, {url: '/tone2.wav', crossfadeSeconds: 2})); await delay(150)
  return {engine, states}
}
document.querySelector('button')!.addEventListener('click', async () => {
  try {
    await Tone.start()
    await probe('A01-real-media-pause-during-crossfade', async () => {
      const {engine, states} = await transition()
      try {
        engine.pause()
        const audible = media.filter(audio => !audio.paused && audio.volume > 0)
        check(audible.length === 1, 'Expected outgoing real HTMLAudio to keep playing')
        await delay(2200)
        check(states.at(-1) === 'playing', 'Expected fade callback to overwrite paused state')
        return {audibleDecksAfterPause: audible.length, lastPublicState: states.at(-1)}
      } finally { engine.dispose() }
    })
    await probe('A02-real-media-master-zero-during-crossfade', async () => {
      const {engine} = await transition()
      try {
        engine.setMasterVolume(0); await delay(150)
        const deckVolumes = media.map(audio => audio.volume)
        check(deckVolumes.some(value => value > .1), 'Expected outgoing deck to bypass zero master')
        return {requestedMaster: 0, deckVolumes}
      } finally { engine.dispose() }
    })
    await probe('A03-real-media-natural-end-state', async () => {
      const states: string[] = [], engine = new MusicEngine(state => states.push(state))
      try {
        await engine.play(cue(3, {url: '/short.wav', loop: false}))
        const audio = media.find(audio => !audio.paused)!
        await new Promise<void>((resolve, reject) => {
          if (audio.ended) return resolve()
          audio.addEventListener('ended', () => resolve(), {once: true})
          setTimeout(() => reject(new Error('Timed out awaiting real ended event')), 3000)
        })
        check(states.at(-1) === 'playing', 'Expected stale playing state')
        return {mediaEnded: audio.ended, lastPublicState: states.at(-1)}
      } finally { engine.dispose() }
    })
    await probe('A10-real-tone-procedural-first-play-zero-ramp', async () => {
      const states: string[] = [], engine = new HybridMusicEngine(state => states.push(state))
      try {
        await engine.play(cue(6, {sourceType: 'procedural', recipe: DEFAULT_PROCEDURAL_RECIPE}))
        check(states.at(-1) === 'error', 'Expected actual procedural first-play error')
        let zeroRampError = ''
        try { Tone.getTransport().bpm.rampTo(60, 0) } catch (error) { zeroRampError = String(error) }
        check(zeroRampError.includes('linearRampToValueAtTime'), 'Expected Tone zero-duration tempo ramp failure')
        return {lastPublicState: states.at(-1), zeroRampError}
      } finally { engine.dispose() }
    })
    // Isolate cancellation from A10: only zero-duration tempo assignment is
    // replaced with its intended immediate value; real synthesis is retained.
    const bpm = Tone.getTransport().bpm, originalRamp = bpm.rampTo
    bpm.rampTo = function (value: any, seconds: any, start?: any) {
      if (seconds === 0) { this.value = value; return this }
      return originalRamp.call(this, value, seconds, start)
    }
    for (const action of ['stop', 'pause', 'dispose'] as const) {
      await probe('A04-real-tone-late-start-after-' + action, async () => {
        let release!: () => void, entered = false
        const gate = new Promise<void>(resolve => release = resolve)
        const original = Tone.Reverb.prototype.generate
        Tone.Reverb.prototype.generate = async function (...args: any[]) {
          entered = true; await gate
          return original.apply(this, args as [])
        }
        const states: string[] = [], engine = new HybridMusicEngine(state => states.push(state))
        try {
          const pending = engine.play(cue(4, {sourceType: 'procedural', recipe: DEFAULT_PROCEDURAL_RECIPE}))
          for (let i = 0; i < 300 && !entered; i++) await delay(10)
          check(entered, 'Reverb preparation did not enter controlled delay')
          engine[action](); const stateAfterAction = states.at(-1)
          release(); await pending
          check(states.at(-1) === 'playing', 'Expected engine late-start after user action')
          check(Tone.getTransport().state === 'started', 'Expected real Tone transport to restart')
          return {action, stateAfterAction, lastPublicState: states.at(-1), transport: Tone.getTransport().state, isolation: 'A10 zero-duration tempo ramp replaced by immediate value assignment'}
        } finally {
          release(); Tone.Reverb.prototype.generate = original
          ;(engine as any).procedural.stop(); engine.dispose()
        }
      })
    }
    bpm.rampTo = originalRamp
    await probe('A07-real-adaptive-stems-startup-offset', async () => {
      const engine = new AdaptiveLayerMusicEngine(() => {})
      try {
        await engine.play(cue(5, {adaptiveLayers: [
          {id: 1, url: '/tone.wav?fast=1', defaultGain: 1, loop: true},
          {id: 2, url: '/delayed.wav', defaultGain: 1, loop: true},
        ] as any}))
        await delay(350)
        const times = media.map(audio => audio.currentTime)
        const startupOffsetSeconds = Math.abs(times[0] - times[1])
        check(startupOffsetSeconds > .15, 'Expected independent media startup offset before sync monitor')
        await delay(2200)
        const afterSyncTimes = media.map(audio => audio.currentTime)
        return {times, startupOffsetSeconds, afterSyncOffsetSeconds: Math.abs(afterSyncTimes[0] - afterSyncTimes[1])}
      } finally { engine.dispose() }
    })
    ;(window as any).auditResults = {userAgent: navigator.userAgent, fixture: 'real Chromium HTMLAudio and Tone; local sine WAVs; controlled Reverb preparation delay', results}
  } catch (error) { (window as any).auditResults = {fatal: String((error as Error).stack), results} }
})
