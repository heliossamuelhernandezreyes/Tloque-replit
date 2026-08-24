import test from "node:test"
import assert from "node:assert/strict"
import { convertAiffPcmToWav } from "../server/aiffPcm"

function aiff16StereoFixture() {
  const pcm = Buffer.from([
    0x12, 0x34, 0xed, 0xcc,
    0x7f, 0xff, 0x80, 0x00,
  ])
  const comm = Buffer.alloc(26)
  comm.write("COMM", 0, 4, "ascii")
  comm.writeUInt32BE(18, 4)
  comm.writeUInt16BE(2, 8)
  comm.writeUInt32BE(2, 10)
  comm.writeUInt16BE(16, 14)
  Buffer.from([0x40, 0x0e, 0xac, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).copy(comm, 16)

  const ssnd = Buffer.alloc(16 + pcm.length)
  ssnd.write("SSND", 0, 4, "ascii")
  ssnd.writeUInt32BE(8 + pcm.length, 4)
  ssnd.writeUInt32BE(0, 8)
  ssnd.writeUInt32BE(0, 12)
  pcm.copy(ssnd, 16)

  const out = Buffer.alloc(12 + comm.length + ssnd.length)
  out.write("FORM", 0, 4, "ascii")
  out.writeUInt32BE(out.length - 8, 4)
  out.write("AIFF", 8, 4, "ascii")
  comm.copy(out, 12)
  ssnd.copy(out, 12 + comm.length)
  return out
}

test("convierte AIFF PCM 16-bit big-endian a WAV PCM little-endian", () => {
  const wav = convertAiffPcmToWav(aiff16StereoFixture())
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF")
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE")
  assert.equal(wav.readUInt16LE(22), 2)
  assert.equal(wav.readUInt32LE(24), 44_100)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.deepEqual([...wav.subarray(44)], [0x34, 0x12, 0xcc, 0xed, 0xff, 0x7f, 0x00, 0x80])
})

test("rechaza bytes arbitrarios y AIFF truncado", () => {
  assert.throws(() => convertAiffPcmToWav(Buffer.from("not-aiff")), /FORM AIFF/)
  const truncated = aiff16StereoFixture().subarray(0, 30)
  assert.throws(() => convertAiffPcmToWav(truncated), /truncado/)
})
