export interface AcousticStagePlacement {
  panOffset: number
  depth: number
  roomSend: number
  presence: number
}

const DEFAULT_PLACEMENT: AcousticStagePlacement = { panOffset: 0, depth: 0.34, roomSend: 0.18, presence: 1 }

export function acousticPlacementForInstrument(instrument: string): AcousticStagePlacement {
  if (instrument === "strings.violin") return { panOffset: -0.18, depth: 0.20, roomSend: 0.16, presence: 1.04 }
  if (instrument === "strings.violin-section") return { panOffset: -0.42, depth: 0.34, roomSend: 0.23, presence: 0.98 }
  if (instrument === "strings.viola") return { panOffset: -0.12, depth: 0.38, roomSend: 0.24, presence: 0.97 }
  if (instrument === "strings.cello") return { panOffset: 0.18, depth: 0.36, roomSend: 0.22, presence: 0.99 }
  if (instrument === "strings.contrabass") return { panOffset: 0.34, depth: 0.42, roomSend: 0.24, presence: 0.96 }
  if (instrument.startsWith("woodwinds.")) return { panOffset: 0, depth: 0.48, roomSend: 0.27, presence: 0.96 }
  if (instrument.startsWith("brass.")) return { panOffset: 0.08, depth: 0.66, roomSend: 0.34, presence: 0.91 }
  if (instrument.startsWith("percussion.")) return { panOffset: 0.12, depth: 0.78, roomSend: 0.39, presence: 0.88 }
  if (instrument.startsWith("keys.pipe-organ")) return { panOffset: 0, depth: 0.88, roomSend: 0.48, presence: 0.90 }
  if (instrument === "keys.harpsichord") return { panOffset: -0.08, depth: 0.28, roomSend: 0.17, presence: 1.01 }
  if (instrument === "piano.grand") return { panOffset: 0, depth: 0.26, roomSend: 0.18, presence: 1 }
  if (instrument.startsWith("guitar.")) return { panOffset: 0.10, depth: 0.18, roomSend: 0.13, presence: 1.03 }
  return DEFAULT_PLACEMENT
}

function deterministicNoise(index: number) {
  const x = Math.sin((index + 1) * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function createEarlyReflectionImpulse(context: BaseAudioContext, seconds = 0.46) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      const t = i / context.sampleRate
      const envelope = Math.exp(-t * 8.4)
      const early = t < 0.12 ? (1 - t / 0.12) * 0.28 : 0
      data[i] = deterministicNoise(i * 2 + channel * 7919) * envelope * (0.08 + early)
    }
  }
  return impulse
}

export interface AcousticStage {
  createTrackInput(instrument: string, scorePan: number): GainNode
  disconnect(): void
}

/** Shared live/offline orchestral stage. It adds family placement, distance,
 * air absorption and short early reflections before the shared concert-room master.
 * The stage intentionally avoids a second long reverb tail: the master owns that tail. */
export function createAcousticStage(context: BaseAudioContext, destination: AudioNode): AcousticStage {
  const earlyRoom = context.createConvolver()
  earlyRoom.normalize = true
  earlyRoom.buffer = createEarlyReflectionImpulse(context)
  const earlyReturn = context.createGain(); earlyReturn.gain.value = 0.46
  earlyRoom.connect(earlyReturn); earlyReturn.connect(destination)
  const nodes: AudioNode[] = [earlyRoom, earlyReturn]

  function createTrackInput(instrument: string, scorePan: number) {
    const placement = acousticPlacementForInstrument(instrument)
    const input = context.createGain()
    const distance = context.createGain(); distance.gain.value = placement.presence * (1 - placement.depth * 0.13)
    const air = context.createBiquadFilter(); air.type = "lowpass"; air.frequency.value = 20_000 - placement.depth * 7_500; air.Q.value = 0.2
    const delay = context.createDelay(0.05); delay.delayTime.value = 0.003 + placement.depth * 0.012
    const dry = context.createGain(); dry.gain.value = 1
    const send = context.createGain(); send.gain.value = placement.roomSend
    input.connect(distance); distance.connect(air); air.connect(delay)
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, scorePan + placement.panOffset))
      delay.connect(panner); panner.connect(dry); panner.connect(send); nodes.push(panner)
    } else { delay.connect(dry); delay.connect(send) }
    dry.connect(destination); send.connect(earlyRoom)
    nodes.push(input, distance, air, delay, dry, send)
    return input
  }

  return { createTrackInput, disconnect() { for (const node of nodes) node.disconnect() } }
}
