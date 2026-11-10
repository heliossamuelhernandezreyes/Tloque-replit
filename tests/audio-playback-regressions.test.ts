import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {readFile, mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'

test('audio controls, late loads, metadata and SoundFont pause respect user intent', async () => {
  const output = resolve('.tloque_cache/audio-regressions/playback.mjs')
  await mkdir(resolve(output, '..'), {recursive: true})
  const tone = await readFile('tests/fixtures/audio-tone-fixture.mjs', 'utf8')
  await build({entryPoints: ['tests/fixtures/audio-playback-regressions.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{
    name: 'controlled-audio-primitives', setup(b) {
      b.onResolve({filter: /^tone$/}, () => ({path: 'tone', namespace: 'tone-fixture'}))
      b.onLoad({filter: /.*/, namespace: 'tone-fixture'}, () => ({contents: tone, loader: 'js'}))
      b.onResolve({filter: /\?url$/}, a => ({path: a.path, namespace: 'asset'}))
      b.onLoad({filter: /.*/, namespace: 'asset'}, () => ({contents: 'export default "/unused-worklet.js"', loader: 'js'}))
    },
  }]})
  const result = spawnSync(process.execPath, [output], {encoding: 'utf8', timeout: 15_000})
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
