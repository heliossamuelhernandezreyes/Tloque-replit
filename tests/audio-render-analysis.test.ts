import test from "node:test"
import assert from "node:assert/strict"
import { analyzePcmChannels, assessAudioMasteringSafety } from "../client/src/audio/AudioRenderAnalysis"

test("post-render analysis reports peak, estimated inter-sample peak, RMS, crest and clipping deterministically", () => {
  const left = new Float32Array([0, 0.5, -0.5, 1])
  const right = new Float32Array([0, 0.25, -0.25, -1])
  const a = analyzePcmChannels([left, right], 48_000)
  const b = analyzePcmChannels([left, right], 48_000)
  assert.deepEqual(a, b)
  assert.equal(a.sampleRate, 48_000)
  assert.equal(a.channelCount, 2)
  assert.equal(a.frameCount, 4)
  assert.equal(a.peakLinear, 1)
  assert.equal(a.peakDbfs, 0)
  assert.ok(a.estimatedInterSamplePeakLinear >= a.peakLinear)
  assert.ok(a.estimatedInterSamplePeakDbfs >= a.peakDbfs)
  assert.equal(a.clippedSampleCount, 2)
  assert.ok(a.rmsLinear > 0 && a.rmsLinear < 1)
  assert.ok(a.rmsDbfs < 0)
  assert.ok(a.crestFactorDb > 0)
  assert.equal(a.dcOffset, 0)
  assert.equal(assessAudioMasteringSafety(a).status, "fail")
})

test("cubic oversampling can expose a likely inter-sample overshoot without calling it true peak", () => {
  const channel = new Float32Array([0.82, 0.99, 0.99, 0.82, 0])
  const result = analyzePcmChannels([channel], 48_000)
  assert.ok(result.estimatedInterSamplePeakLinear >= result.peakLinear)
  assert.ok(Number.isFinite(result.estimatedInterSamplePeakDbfs))
})

test("mastering safety warns on narrow headroom without modifying the PCM", () => {
  const channel = new Float32Array([0, 0.93, -0.93, 0])
  const result = analyzePcmChannels([channel], 48_000)
  const safety = assessAudioMasteringSafety(result)
  assert.notEqual(safety.status, "pass")
  assert.ok(Math.abs(result.peakLinear - 0.93) < 1e-6)
})

test("silence stays well-defined without inventing loudness", () => {
  const result = analyzePcmChannels([new Float32Array(16)], 32_000)
  assert.equal(result.peakLinear, 0)
  assert.equal(result.estimatedInterSamplePeakLinear, 0)
  assert.equal(result.rmsLinear, 0)
  assert.equal(result.peakDbfs, -Infinity)
  assert.equal(result.estimatedInterSamplePeakDbfs, -Infinity)
  assert.equal(result.rmsDbfs, -Infinity)
  assert.equal(result.crestFactorDb, 0)
  assert.equal(result.clippedSampleCount, 0)
  assert.equal(assessAudioMasteringSafety(result).status, "pass")
})
