export interface AudioRenderAnalysis {
  sampleRate: number
  channelCount: number
  frameCount: number
  peakLinear: number
  peakDbfs: number
  /** Conservative 4x cubic estimate. This is not an ITU/EBU true-peak meter. */
  estimatedInterSamplePeakLinear: number
  estimatedInterSamplePeakDbfs: number
  rmsLinear: number
  rmsDbfs: number
  crestFactorDb: number
  dcOffset: number
  clippedSampleCount: number
}

export type AudioMasteringSafetyStatus = "pass" | "warn" | "fail"
export interface AudioMasteringSafetyReport {
  status: AudioMasteringSafetyStatus
  reasons: readonly string[]
}

function dbfs(value: number) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity
}

function cubicInterpolate(y0: number, y1: number, y2: number, y3: number, t: number) {
  // Catmull-Rom cubic interpolation. It intentionally permits overshoot so the
  // diagnostic can expose likely inter-sample peaks that sample-peak misses.
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
  const a2 = -0.5 * y0 + 0.5 * y2
  return ((a0 * t + a1) * t + a2) * t + y1
}

function estimatedInterSamplePeak(channels: readonly Float32Array[]) {
  let peak = 0
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]))
    for (let i = 0; i + 1 < channel.length; i += 1) {
      const y0 = channel[Math.max(0, i - 1)]
      const y1 = channel[i]
      const y2 = channel[i + 1]
      const y3 = channel[Math.min(channel.length - 1, i + 2)]
      peak = Math.max(
        peak,
        Math.abs(cubicInterpolate(y0, y1, y2, y3, 0.25)),
        Math.abs(cubicInterpolate(y0, y1, y2, y3, 0.5)),
        Math.abs(cubicInterpolate(y0, y1, y2, y3, 0.75)),
      )
    }
  }
  return peak
}

/**
 * Deterministic post-render diagnostics. RMS is an energy diagnostic, not LUFS.
 * Inter-sample peak is a conservative cubic estimate, not standards-compliant
 * ITU-R BS.1770 true peak. Master export must keep those distinctions explicit.
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
  const estimatedInterSamplePeakLinear = estimatedInterSamplePeak(channels)

  return {
    sampleRate,
    channelCount,
    frameCount,
    peakLinear,
    peakDbfs: dbfs(peakLinear),
    estimatedInterSamplePeakLinear,
    estimatedInterSamplePeakDbfs: dbfs(estimatedInterSamplePeakLinear),
    rmsLinear,
    rmsDbfs: dbfs(rmsLinear),
    crestFactorDb,
    dcOffset,
    clippedSampleCount,
  }
}

/**
 * A conservative safety classification for diagnostics. It does not normalize
 * or reject musical dynamics and therefore is safe to run before we calibrate a
 * standards-compliant LUFS/true-peak mastering policy.
 */
export function assessAudioMasteringSafety(analysis: AudioRenderAnalysis): AudioMasteringSafetyReport {
  const reasons: string[] = []
  let status: AudioMasteringSafetyStatus = "pass"
  const fail = (reason: string) => { status = "fail"; reasons.push(reason) }
  const warn = (reason: string) => { if (status === "pass") status = "warn"; reasons.push(reason) }

  if (analysis.clippedSampleCount > 0 || analysis.peakLinear >= 1) fail("PCM contiene muestras recortadas")
  if (analysis.estimatedInterSamplePeakLinear >= 1) fail("La estimación inter-sample supera 0 dBFS")
  else if (analysis.estimatedInterSamplePeakDbfs > -1) warn("Margen inter-sample estimado menor de 1 dB")
  if (Math.abs(analysis.dcOffset) > 0.02) fail("Offset DC excesivo")
  else if (Math.abs(analysis.dcOffset) > 0.005) warn("Offset DC perceptible en diagnóstico")
  if (analysis.crestFactorDb < 4 && analysis.rmsLinear > 0) warn("Crest factor muy bajo; revisar sobrecompresión")

  return { status, reasons }
}

export function analyzeAudioBuffer(buffer: AudioBuffer): AudioRenderAnalysis {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  return analyzePcmChannels(channels, buffer.sampleRate)
}
