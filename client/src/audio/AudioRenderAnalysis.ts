export interface AudioRenderAnalysis {
  sampleRate: number
  channelCount: number
  frameCount: number
  peakLinear: number
  peakDbfs: number
  rmsLinear: number
  rmsDbfs: number
  crestFactorDb: number
  dcOffset: number
  clippedSampleCount: number
}

function dbfs(value: number) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity
}

/**
 * Deterministic post-render diagnostics. This deliberately reports sample peak
 * and energy/RMS rather than claiming standards-compliant LUFS or true-peak.
 * Those require dedicated oversampling/K-weighting and are a later mastering gate.
 */
export function analyzePcmChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
): AudioRenderAnalysis {
  const channelCount = channels.length
  const frameCount = channels.reduce((max, channel) => Math.max(max, channel.length), 0)
  let peakLinear = 0
  let sumSquares = 0
  let sum = 0
  let sampleCount = 0
  let clippedSampleCount = 0

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i]
      const absolute = Math.abs(value)
      if (absolute > peakLinear) peakLinear = absolute
      if (absolute >= 1) clippedSampleCount += 1
      sumSquares += value * value
      sum += value
      sampleCount += 1
    }
  }

  const rmsLinear = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0
  const dcOffset = sampleCount ? sum / sampleCount : 0
  const crestFactorDb = peakLinear > 0 && rmsLinear > 0 ? dbfs(peakLinear / rmsLinear) : 0

  return {
    sampleRate,
    channelCount,
    frameCount,
    peakLinear,
    peakDbfs: dbfs(peakLinear),
    rmsLinear,
    rmsDbfs: dbfs(rmsLinear),
    crestFactorDb,
    dcOffset,
    clippedSampleCount,
  }
}

export function analyzeAudioBuffer(buffer: AudioBuffer): AudioRenderAnalysis {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  return analyzePcmChannels(channels, buffer.sampleRate)
}
