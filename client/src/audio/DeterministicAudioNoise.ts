const sharedBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>()

function hashText(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function xorshift32(state: number) {
  let value = state >>> 0 || 0x6d2b79f5
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

function buildNoiseBuffer(context: BaseAudioContext, identity: string, seconds: number, smoothing: number) {
  const frames = Math.max(128, Math.ceil(context.sampleRate * seconds))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  const keep = Math.max(0, Math.min(0.98, smoothing))
  const inject = 1 - keep
  let randomState = hashText(identity)
  let coloured = 0
  for (let index = 0; index < data.length; index += 1) {
    randomState = xorshift32(randomState)
    const white = (randomState / 0xffffffff) * 2 - 1
    coloured = coloured * keep + white * inject
    data[index] = coloured
  }
  return buffer
}

/** Stable one-off noise, kept for callers that truly need an identity-specific buffer. */
export function createDeterministicNoiseBuffer(
  context: BaseAudioContext,
  identity: string,
  seconds: number,
  smoothing: number,
) {
  return buildNoiseBuffer(context, identity, seconds, smoothing)
}

/**
 * Shared long noise bed for physical voices. One buffer is generated per context and
 * spectral family, then every note starts at a deterministic offset. This removes a
 * large Float32 allocation and random-fill loop from every scheduled note without
 * sacrificing reproducibility or making repeated notes begin at the same texture.
 */
export function sharedDeterministicNoiseBuffer(
  context: BaseAudioContext,
  family: string,
  seconds = 8,
  smoothing = 0.7,
) {
  let byFamily = sharedBuffers.get(context)
  if (!byFamily) { byFamily = new Map(); sharedBuffers.set(context, byFamily) }
  const key = `${family}:${context.sampleRate}:${seconds}:${smoothing}`
  const existing = byFamily.get(key)
  if (existing) return existing
  const buffer = buildNoiseBuffer(context, `shared:${key}`, seconds, smoothing)
  byFamily.set(key, buffer)
  return buffer
}

export function deterministicNoiseOffset(identity: string, bufferDurationSeconds: number) {
  if (!(bufferDurationSeconds > 0)) return 0
  const unit = hashText(identity) / 0xffffffff
  return Math.max(0, Math.min(bufferDurationSeconds * 0.999, unit * bufferDurationSeconds))
}
