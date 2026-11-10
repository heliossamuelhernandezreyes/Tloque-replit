import { MusicEngine, type MusicCue } from '../../client/src/audio/MusicEngine'
import { HybridMusicEngine } from '../../client/src/audio/HybridMusicEngine'
import { AdaptiveLayerMusicEngine } from '../../client/src/audio/AdaptiveLayerMusicEngine'
import { NativeSamplePackPlayer } from '../../client/src/audio/NativeSamplePackEngine'
import { DEFAULT_PROCEDURAL_RECIPE } from '../../shared/audio'
import * as Tone from 'tone'

// Real-browser regressions for the audio audit: passing means corrected behavior.
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
  try { results.push({ id, passed: true, ...await run() }) }
  catch (error) { results.push({ id, passed: false, error: String((error as Error).stack) }) }
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
        check(audible.length === 0, 'Pause must stop both real media decks')
        await delay(2200)
        check(states.at(-1) === 'paused', 'A paused fade must not overwrite user intent')
        const stateAfterWait = states.at(-1)
        await engine.resume(); await delay(2300)
        check(states.at(-1) === 'playing', 'Resume must finish the retained fade')
        return {audibleDecksAfterPause: audible.length, stateAfterWait, lastPublicState: states.at(-1)}
      } finally { engine.dispose() }
    })
    await probe('A02-real-media-master-zero-during-crossfade', async () => {
      const {engine} = await transition()
      try {
        engine.setMasterVolume(0); await delay(150)
        const deckVolumes = media.map(audio => audio.volume)
        check(deckVolumes.every(value => value === 0), 'Zero master must mute every real media deck')
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
        check(states.at(-1) === 'paused', 'Natural end must update public playback state')
        return {mediaEnded: audio.ended, lastPublicState: states.at(-1)}
      } finally { engine.dispose() }
    })
    await probe('A10-real-tone-procedural-first-play', async () => {
      const states: string[] = [], engine = new HybridMusicEngine(state => states.push(state))
      try {
        await engine.play(cue(6, {sourceType: 'procedural', recipe: DEFAULT_PROCEDURAL_RECIPE}))
        check(states.at(-1) === 'playing', 'Procedural music must start without zero-duration tempo automation')
        check(Tone.getTransport().state === 'started', 'Procedural transport must start')
        return {lastPublicState: states.at(-1), transport: Tone.getTransport().state}
      } finally { engine.dispose() }
    })
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
          check(states.at(-1) === (action === 'pause' ? 'paused' : 'idle'), 'A late load must respect stop, pause and dispose')
          check(Tone.getTransport().state !== 'started', 'Cancelled or paused transport must stay stopped')
          return {action, stateAfterAction, lastPublicState: states.at(-1), transport: Tone.getTransport().state}
        } finally {
          release(); Tone.Reverb.prototype.generate = original
          ;(engine as any).procedural.stop(); engine.dispose()
        }
      })
    }
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
        check(startupOffsetSeconds < .08, 'All stems must be ready before starting their media clocks')
        await delay(2200)
        const afterSyncTimes = media.map(audio => audio.currentTime)
        return {times, startupOffsetSeconds, afterSyncOffsetSeconds: Math.abs(afterSyncTimes[0] - afterSyncTimes[1])}
      } finally { engine.dispose() }
    })
    await probe('A06-real-adaptive-crossfade-pause-and-resume', async () => {
      const states: string[] = [], engine = new AdaptiveLayerMusicEngine(state => states.push(state))
      const layers = [{id: 1, url: '/tone.wav', defaultGain: 1, loop: true}] as any
      try {
        await engine.play(cue(7, {adaptiveLayers: layers})); await delay(350)
        await engine.play(cue(8, {adaptiveLayers: layers, crossfadeSeconds: 2})); await delay(150)
        engine.pause(); check(media.every(audio => audio.paused), 'Every adaptive deck must pause')
        await delay(2200); check(states.at(-1) === 'paused', 'Adaptive fade must retain pause')
        check((engine as any).groups.filter(Boolean).length === 2, 'Pause must retain both groups')
        await engine.resume(); await delay(2300)
        check((engine as any).groups.filter(Boolean).length === 1, 'Resume must complete retained fade')
        return {pausedDuringWait: true, groupsAfterResume: (engine as any).groups.filter(Boolean).length}
      } finally { engine.dispose() }
    })
    await probe('A11-real-native-sample-integrity-and-valid-decode', async () => {
      const context = new AudioContext(), player = new NativeSamplePackPlayer(context)
      try {
        const url = '/api/audio/sample-packs/samples/' + 'a'.repeat(64) + '.wav'
        const bytes = await (await fetch(url)).arrayBuffer()
        const actualSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
        let rejected = false
        try { await player.preload([{sampleUrl: url, sha256: 'a'.repeat(64)} as any]) } catch { rejected = true }
        check(rejected, 'Native sample with incorrect SHA must be rejected')
        const validUrl = '/api/audio/sample-packs/samples/' + actualSha256 + '.wav'
        const [buffer] = await player.preload([{sampleUrl: validUrl, sha256: actualSha256} as any])
        check(buffer.duration > 0, 'Valid native WAV must still decode')
        return {mismatchedSampleRejected: rejected, validDecodedSeconds: buffer.duration}
      } finally { await context.close() }
    })
    ;(window as any).audioRegressionResults = {userAgent: navigator.userAgent, fixture: 'real Chromium HTMLAudio and Tone; local sine WAVs; controlled Reverb preparation delay', results}
  } catch (error) { (window as any).audioRegressionResults = {fatal: String((error as Error).stack), results} }
})
