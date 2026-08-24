import test from "node:test"
import assert from "node:assert/strict"
import { IOWA_BASS_CLARINET_FF_PACK } from "../shared/curated-external-pcm-packs"
import { downloadCuratedExternalPcmPack, fixedExternalPcmUrl, assertFixedExternalResponse } from "../server/externalPcmInstaller"
import { compileCuratedSfzZones } from "../server/sfzSamplePackCompiler"

function tinyAiff() {
  const pcm = Buffer.from([0x12, 0x34, 0xed, 0xcc])
  const comm = Buffer.alloc(26)
  comm.write("COMM", 0, 4, "ascii")
  comm.writeUInt32BE(18, 4)
  comm.writeUInt16BE(1, 8)
  comm.writeUInt32BE(2, 10)
  comm.writeUInt16BE(16, 14)
  Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]).copy(comm, 16)
  const ssnd = Buffer.alloc(16 + pcm.length)
  ssnd.write("SSND", 0, 4, "ascii")
  ssnd.writeUInt32BE(8 + pcm.length, 4)
  pcm.copy(ssnd, 16)
  const out = Buffer.alloc(12 + comm.length + ssnd.length)
  out.write("FORM", 0, 4, "ascii")
  out.writeUInt32BE(out.length - 8, 4)
  out.write("AIFF", 8, 4, "ascii")
  comm.copy(out, 12)
  ssnd.copy(out, 12 + comm.length)
  return out
}

function responseAt(url: string, bytes = tinyAiff()) {
  const response = new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length), "content-type": "audio/aiff" } })
  Object.defineProperty(response, "url", { configurable: true, value: url })
  return response
}

test("el adaptador Iowa descarga AIFF fijado y publica únicamente WAV interno", async () => {
  const fixture = tinyAiff()
  const fetcher = (async (input: string | URL | Request) => responseAt(String(input), fixture)) as typeof fetch
  const downloaded = await downloadCuratedExternalPcmPack(IOWA_BASS_CLARINET_FF_PACK, fetcher)
  assert.equal(downloaded.samples.length, 46)
  assert.ok(downloaded.samples.every(sample => sample.sourcePath.endsWith(".wav")))
  assert.ok(downloaded.samples.every(sample => sample.bytes.subarray(0, 4).toString("ascii") === "RIFF"))
  assert.ok(downloaded.samples.every(sample => /^[a-f0-9]{64}$/.test(sample.sha256)))
  const zones = compileCuratedSfzZones(downloaded.sfzText)
  assert.equal(zones.length, 46)
  assert.ok(zones.every(zone => zone.samplePath.endsWith(".wav")))
})

test("el adaptador rechaza una redirección fuera del origen o prefijo institucional", () => {
  const allowed = fixedExternalPcmUrl(IOWA_BASS_CLARINET_FF_PACK, IOWA_BASS_CLARINET_FF_PACK.externalPaths[0])
  assert.doesNotThrow(() => assertFixedExternalResponse(responseAt(allowed), IOWA_BASS_CLARINET_FF_PACK))
  assert.throws(() => assertFixedExternalResponse(responseAt("https://evil.example/sample.aif"), IOWA_BASS_CLARINET_FF_PACK), /fuera del origen/)
  assert.throws(() => assertFixedExternalResponse(responseAt("https://theremin.music.uiowa.edu/other/sample.aif"), IOWA_BASS_CLARINET_FF_PACK), /fuera de la ruta/)
})
