/* Tloque bowed-string DSP v3. Original deterministic waveguide processor. */
class TloqueBowedStringV3 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequency", defaultValue: 440, minValue: 20, maxValue: 12000, automationRate: "a-rate" },
      { name: "detune", defaultValue: 0, minValue: -2400, maxValue: 2400, automationRate: "a-rate" },
      { name: "bowPressure", defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "bowPosition", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "brightness", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "gate", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "a-rate" },
    ]
  }

  constructor(options) {
    super()
    const config = options.processorOptions || {}
    this.startFrame = Math.max(0, config.startFrame || 0)
    this.endFrame = Math.max(this.startFrame + 1, config.endFrame || this.startFrame + sampleRate)
    this.releaseFrames = Math.max(128, config.releaseFrames || sampleRate * 0.35)
    this.finishFrame = this.endFrame + this.releaseFrames
    this.oversample = config.oversample === 4 ? 4 : config.oversample === 2 ? 2 : 1
    this.internalRate = sampleRate * this.oversample
    this.feedback = Math.max(0.9, Math.min(0.992, config.feedback || 0.978))
    this.stiffness = Math.max(0, Math.min(0.5, config.stiffness || 0.14))
    this.rng = Math.max(1, config.seed | 0)
    this.delay = new Float32Array(Math.ceil(this.internalRate / 20) + 16)
    this.writeIndex = 0
    this.previousString = 0
    this.previousInput = 0
    this.previousHighpass = 0
    this.reportedEnd = false
  }

  valueAt(values, index) { return values.length === 1 ? values[0] : values[index] }

  noise() {
    let value = this.rng | 0
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5
    this.rng = value | 0
    return ((value >>> 0) / 0x100000000) * 2 - 1
  }

  readDelay(delaySamples) {
    const whole = Math.floor(delaySamples)
    const fraction = delaySamples - whole
    let first = this.writeIndex - whole
    while (first < 0) first += this.delay.length
    const second = first > 0 ? first - 1 : this.delay.length - 1
    return this.delay[first] * (1 - fraction) + this.delay[second] * fraction
  }

  process(_inputs, outputs, parameters) {
    const output = outputs[0][0]
    for (let index = 0; index < output.length; index += 1) {
      const frame = currentFrame + index
      if (frame < this.startFrame) { output[index] = 0; continue }
      const frequency = Math.max(20, this.valueAt(parameters.frequency, index)) * 2 ** (this.valueAt(parameters.detune, index) / 1200)
      const pressure = Math.max(0, Math.min(1, this.valueAt(parameters.bowPressure, index)))
      const bowPosition = Math.max(0, Math.min(1, this.valueAt(parameters.bowPosition, index)))
      const brightness = Math.max(0, Math.min(1, this.valueAt(parameters.brightness, index)))
      const gate = frame <= this.endFrame ? Math.max(0, Math.min(1, this.valueAt(parameters.gate, index))) : 0
      let value = 0
      for (let substep = 0; substep < this.oversample; substep += 1) {
        const delaySamples = Math.max(2, this.internalRate / frequency - 0.4 - this.stiffness * 0.18)
        const stringVelocity = this.readDelay(delaySamples)
        const bowVelocity = (0.18 + pressure * 0.54) * gate
        const relative = bowVelocity - stringVelocity
        const friction = Math.tanh(relative * (2.2 + pressure * 5.4))
        const texture = this.noise() * (0.00025 + brightness * 0.00065 + bowPosition * 0.0007) * gate
        const excitation = friction * pressure * 0.0105 * gate + texture
        const damping = 0.963 + brightness * 0.019 + bowPosition * 0.004
        const dispersed = stringVelocity * (1 - this.stiffness * 0.07) + this.previousString * this.stiffness * 0.07
        const next = Math.tanh((excitation + dispersed * this.feedback * damping) * 1.08)
        this.delay[this.writeIndex] = next
        this.writeIndex = (this.writeIndex + 1) % this.delay.length
        this.previousString = stringVelocity
        value += stringVelocity
      }
      value /= this.oversample
      const highpassed = value - this.previousInput + 0.996 * this.previousHighpass
      this.previousInput = value; this.previousHighpass = highpassed
      const release = frame > this.endFrame ? Math.max(0, (this.finishFrame - frame) / this.releaseFrames) : 1
      output[index] = Math.max(-1, Math.min(1, highpassed * release * 1.8))
    }
    if (currentFrame + output.length >= this.finishFrame) {
      if (!this.reportedEnd) { this.reportedEnd = true; this.port.postMessage("ended") }
      return false
    }
    return true
  }
}

registerProcessor("tloque-bowed-string-v3", TloqueBowedStringV3)
