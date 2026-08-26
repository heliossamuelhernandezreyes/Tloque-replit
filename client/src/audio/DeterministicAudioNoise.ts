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

/** Stable mono coloured-noise buffer for physical models and deterministic A/B renders. */
export function createDeterministicNoiseBuffer(
  context: BaseAudioContext,
  identity: string,
  seconds: number,
  smoothing: number,
) {
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
