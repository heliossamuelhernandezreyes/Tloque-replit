import test from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdir, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

test("el fallback sin AudioContext completa la reproducción y deja pasar el siguiente cue", async () => {
  const built = await build({ entryPoints: ["tests/fixtures/hybrid-fallback.ts"], bundle: true, write: false, platform: "node", format: "esm", packages: "external", plugins: [{ name: "worklet-fixture", setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: "fixture-url" }))
    builder.onLoad({ filter: /.*/, namespace: "fixture-url" }, () => ({ loader: "js", contents: "export default 'file:///fixture-worklet.js'" }))
  } }] })
  const directory = resolve(".tloque_cache/tests")
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, "hybrid-fallback.mjs")
  await writeFile(path, built.outputFiles[0].contents)
  const run = spawnSync(process.execPath, [path], { encoding: "utf8", timeout: 10_000 })
  assert.equal(run.status, 0, run.stderr || String(run.error))
})
