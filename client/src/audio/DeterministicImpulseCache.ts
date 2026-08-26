type StereoTemplate = readonly [Float32Array, Float32Array]

const templates = new Map<string, StereoTemplate>()

export type StereoImpulseSample = (channel: 0 | 1, index: number, timeSeconds: number) => number

/**
 * Cache only deterministic PCM templates. Every AudioContext still receives its
 * own AudioBuffer/Convolver, so lifetime and graph ownership stay isolated while
 * repeated renders avoid recalculating the same impulse sample-by-sample.
 */
export function createCachedDeterministicStereoImpulse(
  context: BaseAudioContext,
  cacheKey: string,
  seconds: number,
  sample: StereoImpulseSample,
): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const key = `${cacheKey}@${context.sampleRate}:${length}`
  let template = templates.get(key)
  if (!template) {
    const left = new Float32Array(length)
    const right = new Float32Array(length)
    for (let i = 0; i < length; i += 1) {
      const timeSeconds = i / context.sampleRate
      left[i] = sample(0, i, timeSeconds)
      right[i] = sample(1, i, timeSeconds)
    }
    template = [left, right]
    templates.set(key, template)
  }

  const buffer = context.createBuffer(2, length, context.sampleRate)
  buffer.copyToChannel(template[0], 0)
  buffer.copyToChannel(template[1], 1)
  return buffer
}

export function deterministicImpulseTemplateCountForTests() {
  return templates.size
}
