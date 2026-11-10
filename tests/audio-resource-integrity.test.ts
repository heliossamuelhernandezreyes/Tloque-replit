import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {fetchAudioResource, cacheNativeSamplePack} from '../client/src/audio/AudioResourceCache'
import {NativeSamplePackPlayer, NativeDecodeBudget, estimatedWavDecodeBytes} from '../client/src/audio/NativeSamplePackEngine'

function wav(seconds = 1) {
  const rate = 48_000, frames = Math.floor(rate * seconds), bytes = Buffer.alloc(44 + frames * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + frames * 2, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40)
  return Uint8Array.from(bytes).buffer
}
const hash = (bytes: ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
const zone = (url: string, sha256?: string) => ({id: url, sampleUrl: url, sha256, articulation: 'normal' as const, rootMidi: 60, loMidi: 0, hiMidi: 127, loVelocity: 0, hiVelocity: 127, velocityLayer: 0, roundRobin: 0, gainDb: 0, tuneCents: 0})

test('sample integrity is checked before decoding; a failed URL can be retried', async () => {
  const original = globalThis.fetch, bytes = wav(), sha256 = hash(bytes)
  let decodes = 0
  const context = {sampleRate: 48_000, decodeAudioData: async () => { decodes++; return {length: 48_000, numberOfChannels: 1} }} as unknown as BaseAudioContext
  globalThis.fetch = async () => new Response(bytes)
  try {
    const player = new NativeSamplePackPlayer(context)
    await assert.rejects(player.preload([zone('/api/audio/sample-packs/fixture.wav', 'a'.repeat(64))]), /huella/)
    assert.equal(decodes, 0); assert.equal(player.retainedSampleCount, 0)
    await player.preload([zone('/api/audio/sample-packs/fixture.wav', sha256)])
    assert.equal(decodes, 1)
  } finally { globalThis.fetch = original }
})

test('decode budget rejects before allocation and stays bounded across modules', async () => {
  const original = globalThis.fetch, bytes = wav(); let decodes = 0
  const context = {sampleRate: 48_000, decodeAudioData: async () => { decodes++; return {length: 48_000, numberOfChannels: 1} }} as unknown as BaseAudioContext
  globalThis.fetch = async () => new Response(bytes)
  try {
    assert.ok(estimatedWavDecodeBytes(bytes, 48_000) >= 192_000)
    const tiny = new NativeSamplePackPlayer(context, undefined, {budget: new NativeDecodeBudget(1_000)})
    await assert.rejects(tiny.preload([zone('/api/audio/sample-packs/a.wav')]), /memoria segura/); assert.equal(decodes, 0)
    const budget = new NativeDecodeBudget(300_000)
    await new NativeSamplePackPlayer(context, undefined, {budget}).preload([zone('/api/audio/sample-packs/a.wav')])
    await assert.rejects(new NativeSamplePackPlayer(context, undefined, {budget}).preload([zone('/api/audio/sample-packs/b.wav')]), /memoria segura/)
    assert.equal(decodes, 1)
  } finally { globalThis.fetch = original }
})

test('abort never turns into an offline fallback', async () => {
  const original = globalThis.fetch, controller = new AbortController()
  controller.abort()
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  try { await assert.rejects(fetchAudioResource('/api/audio/sample-packs/modules/fixture.json', {signal: controller.signal}), {name: 'AbortError'}) }
  finally { globalThis.fetch = original }
})

test('offline pack repairs an already cached corrupt sample before committing its pointer', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window, originalCaches = globalThis.caches
  const entries = new Map<string, Response>(), bytes = wav(), sha256 = hash(bytes), url = `/api/audio/sample-packs/samples/${sha256}.wav`
  const key = (input: RequestInfo | URL) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://fixture.test').pathname
  const cache = {match: async (input: RequestInfo | URL) => entries.get(key(input))?.clone(), put: async (input: RequestInfo | URL, response: Response) => { entries.set(key(input), response.clone()) }, delete: async (input: RequestInfo | URL) => entries.delete(key(input)), keys: async () => [...entries.keys()].map(path => new Request('https://fixture.test' + path))}
  const caches = {open: async () => cache} as unknown as CacheStorage
  globalThis.window = {caches} as unknown as Window & typeof globalThis; globalThis.caches = caches
  entries.set(url, new Response('corrupt cached bytes'))
  let downloads = 0
  const pack = {version: 1, id: 'fixture', name: 'Synthetic fixture', instrumentManifestId: 'vsco2-ce-solo-violin', license: 'CC0-1.0', sourceName: 'fixture', sourceUrl: 'https://fixture.test', zones: [zone(url, sha256)]}
  globalThis.fetch = async input => {
    if (String(input).endsWith('.json')) return Response.json(pack)
    downloads++; return new Response(bytes)
  }
  try {
    await cacheNativeSamplePack('/api/audio/sample-packs/modules/fixture.json')
    assert.equal(downloads, 1); assert.equal(hash(await entries.get(url)!.arrayBuffer()), sha256)
    assert.ok([...entries.keys()].some(path => path.startsWith('/__tloque_audio_module__/')))
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; globalThis.caches = originalCaches }
})
