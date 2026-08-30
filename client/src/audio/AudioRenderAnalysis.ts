export interface AudioRenderAnalysis {
  sampleRate: number
  channelCount: number
  frameCount: number
  peakLinear: number
  peakDbfs: number
  /** Four-times oversampled Catmull-Rom estimate, expressed as dBTP. */
  truePeak4xLinear: number
  truePeak4xDbtp: number
  /** Backwards-compatible aliases for the same 4x diagnostic. */
  estimatedInterSamplePeakLinear: number
  estimatedInterSamplePeakDbfs: number
  /** ITU-R BS.1770-style K-weighting, 400 ms blocks and absolute/relative gates. */
  integratedLufs: number
  maxMomentaryLufs: number
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

interface BiquadState { x1: number; x2: number; y1: number; y2: number }
interface BiquadCoefficients { b0: number; b1: number; b2: number; a1: number; a2: number }

function dbfs(value: number) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity
}

function lufs(energy: number) {
  return energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity
}

function highShelf(sampleRate: number): BiquadCoefficients {
  // De Man parameters used by BS.1770 meters. The bilinear form keeps the
  // weighting valid at every export rate used by Tloque (32/48/96 kHz).
  const frequency = 1_681.974450955533
  const gainDb = 3.999843853973347
  const q = 0.7071752369554196
  const k = Math.tan(Math.PI * frequency / sampleRate)
  const vh = 10 ** (gainDb / 20)
  const vb = vh ** 0.4996667741545416
  const denominator = 1 + k / q + k * k
  return {
    b0: (vh + vb * k / q + k * k) / denominator,
    b1: 2 * (k * k - vh) / denominator,
    b2: (vh - vb * k / q + k * k) / denominator,
    a1: 2 * (k * k - 1) / denominator,
    a2: (1 - k / q + k * k) / denominator,
  }
}

function highPass(sampleRate: number): BiquadCoefficients {
  const frequency = 38.13547087602444
  const q = 0.5003270373238773
  const k = Math.tan(Math.PI * frequency / sampleRate)
  const denominator = 1 + k / q + k * k
  return {
    b0: 1 / denominator,
    b1: -2 / denominator,
    b2: 1 / denominator,
    a1: 2 * (k * k - 1) / denominator,
    a2: (1 - k / q + k * k) / denominator,
  }
}

function filterSample(value: number, coefficients: BiquadCoefficients, state: BiquadState) {
  const output = coefficients.b0 * value + coefficients.b1 * state.x1 + coefficients.b2 * state.x2
    - coefficients.a1 * state.y1 - coefficients.a2 * state.y2
  state.x2 = state.x1
  state.x1 = value
  state.y2 = state.y1
  state.y1 = output
  return output
}

function cubicInterpolate(y0: number, y1: number, y2: number, y3: number, t: number) {
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
  const a2 = -0.5 * y0 + 0.5 * y2
  return ((a0 * t + a1) * t + a2) * t + y1
}

/**
 * Streaming post-render meter. Loudness follows the BS.1770 K-weighting and
 * gating model. True peak is a deterministic 4x interpolated engineering
 * diagnostic, not a substitute for laboratory conformance certification.
 */
export class PcmAnalysisAccumulator {
  private readonly shelf: BiquadCoefficients
  private readonly pass: BiquadCoefficients
  private readonly blockFrames: number
  private readonly stepFrames: number
  private readonly shelfStates: BiquadState[]
  private readonly passStates: BiquadState[]
  private readonly squareRings: Float64Array[]
  private readonly squareSums: number[]
  private readonly interpolationHistory: number[][]
  private readonly blockEnergies: number[] = []
  private peakLinear = 0
  private truePeak4xLinear = 0
  private sumSquares = 0
  private sum = 0
  private sampleCount = 0
  private clippedSampleCount = 0
  private frameCount = 0

  constructor(readonly channelCount: number, readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8_000) throw new Error("Frecuencia de muestreo inválida")
    if (!Number.isInteger(channelCount) || channelCount < 1) throw new Error("Número de canales inválido")
    this.shelf = highShelf(sampleRate)
    this.pass = highPass(sampleRate)
    this.blockFrames = Math.max(1, Math.round(sampleRate * 0.4))
    this.stepFrames = Math.max(1, Math.round(sampleRate * 0.1))
    const emptyState = () => ({ x1: 0, x2: 0, y1: 0, y2: 0 })
    this.shelfStates = Array.from({ length: channelCount }, emptyState)
    this.passStates = Array.from({ length: channelCount }, emptyState)
    this.squareRings = Array.from({ length: channelCount }, () => new Float64Array(this.blockFrames))
    this.squareSums = Array.from({ length: channelCount }, () => 0)
    this.interpolationHistory = Array.from({ length: channelCount }, () => [])
  }

  push(channels: readonly Float32Array[]) {
    const frames = channels.reduce((max, channel) => Math.max(max, channel.length), 0)
    for (let frame = 0; frame < frames; frame += 1) {
      const ringIndex = this.frameCount % this.blockFrames
      for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
        const value = channels[channelIndex]?.[frame] ?? 0
        const absolute = Math.abs(value)
        this.peakLinear = Math.max(this.peakLinear, absolute)
        this.truePeak4xLinear = Math.max(this.truePeak4xLinear, absolute)
        if (absolute >= 1) this.clippedSampleCount += 1
        this.sumSquares += value * value
        this.sum += value
        this.sampleCount += 1

        const history = this.interpolationHistory[channelIndex]
        history.push(value)
        if (history.length === 4) {
          const [y0, y1, y2, y3] = history
          this.truePeak4xLinear = Math.max(
            this.truePeak4xLinear,
            Math.abs(cubicInterpolate(y0, y1, y2, y3, 0.25)),
            Math.abs(cubicInterpolate(y0, y1, y2, y3, 0.5)),
            Math.abs(cubicInterpolate(y0, y1, y2, y3, 0.75)),
          )
          history.shift()
        }

        const weighted = filterSample(
          filterSample(value, this.shelf, this.shelfStates[channelIndex]),
          this.pass,
          this.passStates[channelIndex],
        )
        const square = weighted * weighted
        const ring = this.squareRings[channelIndex]
        this.squareSums[channelIndex] += square - ring[ringIndex]
        ring[ringIndex] = square
      }
      this.frameCount += 1
      if (this.frameCount >= this.blockFrames && (this.frameCount - this.blockFrames) % this.stepFrames === 0) {
        let energy = 0
        for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
          // BS.1770 channel gains. Tloque exports mono/stereo, while these
          // weights also keep the meter correct if surround is analyzed later.
          const channelGain = channelIndex === 3 ? 0 : channelIndex >= 4 ? 1.41 : 1
          energy += channelGain * this.squareSums[channelIndex] / this.blockFrames
        }
        this.blockEnergies.push(energy)
      }
    }
  }

  result(): AudioRenderAnalysis {
    const absoluteGated = this.blockEnergies.filter(energy => lufs(energy) >= -70)
    const absoluteMean = absoluteGated.length
      ? absoluteGated.reduce((sum, energy) => sum + energy, 0) / absoluteGated.length
      : 0
    const relativeGate = lufs(absoluteMean) - 10
    const finalGate = Math.max(-70, relativeGate)
    const relativeGated = absoluteGated.filter(energy => lufs(energy) >= finalGate)
    const gatedMean = relativeGated.length
      ? relativeGated.reduce((sum, energy) => sum + energy, 0) / relativeGated.length
      : 0
    const rmsLinear = this.sampleCount ? Math.sqrt(this.sumSquares / this.sampleCount) : 0
    const dcOffset = this.sampleCount ? this.sum / this.sampleCount : 0
    const crestFactorDb = this.peakLinear > 0 && rmsLinear > 0 ? dbfs(this.peakLinear / rmsLinear) : 0

    return {
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      frameCount: this.frameCount,
      peakLinear: this.peakLinear,
      peakDbfs: dbfs(this.peakLinear),
      truePeak4xLinear: this.truePeak4xLinear,
      truePeak4xDbtp: dbfs(this.truePeak4xLinear),
      estimatedInterSamplePeakLinear: this.truePeak4xLinear,
      estimatedInterSamplePeakDbfs: dbfs(this.truePeak4xLinear),
      integratedLufs: lufs(gatedMean),
      maxMomentaryLufs: this.blockEnergies.length ? Math.max(...this.blockEnergies.map(lufs)) : -Infinity,
      rmsLinear,
      rmsDbfs: dbfs(rmsLinear),
      crestFactorDb,
      dcOffset,
      clippedSampleCount: this.clippedSampleCount,
    }
  }
}

export function analyzePcmChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
): AudioRenderAnalysis {
  const analyzer = new PcmAnalysisAccumulator(Math.max(1, channels.length), sampleRate)
  analyzer.push(channels.length ? channels : [new Float32Array(0)])
  return analyzer.result()
}

/** Reading-safe mastering guardrail. It never normalizes or alters the render. */
export function assessAudioMasteringSafety(analysis: AudioRenderAnalysis): AudioMasteringSafetyReport {
  const reasons: string[] = []
  let status: AudioMasteringSafetyStatus = "pass"
  const fail = (reason: string) => { status = "fail"; reasons.push(reason) }
  const warn = (reason: string) => { if (status === "pass") status = "warn"; reasons.push(reason) }

  if (analysis.clippedSampleCount > 0 || analysis.peakLinear >= 1) fail("PCM contiene muestras recortadas")
  if (analysis.truePeak4xLinear >= 1) fail("El pico verdadero 4× alcanza o supera 0 dBTP")
  else if (analysis.truePeak4xDbtp > -1) warn("Margen de pico verdadero menor de 1 dBTP")
  if (Math.abs(analysis.dcOffset) > 0.02) fail("Offset DC excesivo")
  else if (Math.abs(analysis.dcOffset) > 0.005) warn("Offset DC perceptible en diagnóstico")
  if (Number.isFinite(analysis.integratedLufs)) {
    if (analysis.integratedLufs > -14) fail("Loudness excesivo para acompañar lectura (más alto que -14 LUFS)")
    else if (analysis.integratedLufs > -18) warn("Loudness alto para lectura; revisar ducking y fatiga")
    else if (analysis.integratedLufs < -32) warn("Loudness muy bajo; revisar inteligibilidad musical")
  } else warn("No hay señal suficiente para medir loudness integrado")
  if (analysis.crestFactorDb < 4 && analysis.rmsLinear > 0) warn("Crest factor muy bajo; revisar sobrecompresión")

  return { status, reasons }
}

export function analyzeAudioBuffer(buffer: AudioBuffer): AudioRenderAnalysis {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  return analyzePcmChannels(channels, buffer.sampleRate)
}
