import test from "node:test"
import assert from "node:assert/strict"
import { PcmAnalysisAccumulator, analyzePcmChannels, assessAudioMasteringSafety } from "../client/src/audio/AudioRenderAnalysis"

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

test("el medidor 4x expone un pico entre muestras y lo expresa en dBTP", () => {
  const channel = new Float32Array([0.82, 0.99, 0.99, 0.82, 0])
  const result = analyzePcmChannels([channel], 48_000)
  assert.ok(result.estimatedInterSamplePeakLinear >= result.peakLinear)
  assert.ok(Number.isFinite(result.estimatedInterSamplePeakDbfs))
  assert.equal(result.truePeak4xLinear, result.estimatedInterSamplePeakLinear)
  assert.equal(result.truePeak4xDbtp, result.estimatedInterSamplePeakDbfs)
})

test("loudness integrado usa K-weighting y puertas BS.1770 de forma estable", () => {
  const sampleRate = 48_000
  const channel = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin(index * 2 * Math.PI * 1_000 / sampleRate) * 0.1)
  const result = analyzePcmChannels([channel, channel], sampleRate)
  assert.ok(result.integratedLufs > -24 && result.integratedLufs < -17, `${result.integratedLufs} LUFS`)
  assert.ok(Number.isFinite(result.maxMomentaryLufs))
  assert.notEqual(assessAudioMasteringSafety(result).status, "fail")
})

test("el análisis por bloques coincide con el análisis de un buffer completo", () => {
  const sampleRate = 48_000
  const channel = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 0.05)
  const whole = analyzePcmChannels([channel, channel], sampleRate)
  const streamed = new PcmAnalysisAccumulator(2, sampleRate)
  streamed.push([channel.subarray(0, 17_123), channel.subarray(0, 17_123)])
  streamed.push([channel.subarray(17_123), channel.subarray(17_123)])
  assert.deepEqual(streamed.result(), whole)
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
  assert.equal(result.integratedLufs, -Infinity)
  assert.equal(result.crestFactorDb, 0)
  assert.equal(result.clippedSampleCount, 0)
  assert.equal(assessAudioMasteringSafety(result).status, "warn")
})
