import { proceduralRecipeFor } from "@shared/audio"
import type { MusicCue, MusicState } from "./MusicEngine"

type Listener = (state: MusicState, cue: MusicCue | null) => void

const SCALE = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10],
} as const

const PROGRESSIONS = {
  quiet_observatory: [0, 3, 5, 2],
  warm_memory: [0, 4, 3, 5],
  cold_suspense: [0, 1, 4, 2],
  deep_focus: [0, 5, 3, 4],
} as const

function seeded(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43_758.5453
  return value - Math.floor(value)
}

export class ProceduralMusicEngine {
  private tone: typeof import("tone") | null = null
  private cue: MusicCue | null = null
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1
  private loop: any = null
  private synth: any = null
  private bell: any = null
  private nodes: any[] = []
  private output: any = null

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    this.setState("loading", cue)
    try {
      this.stopRuntime()
      const Tone = this.tone ?? await import("tone")
      this.tone = Tone
      await Tone.start()
      const recipe = proceduralRecipeFor(cue.recipe)
      const output = new Tone.Gain(0)
      const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.08, release: 0.45 })
      const reverb = new Tone.Reverb({ decay: 5 + recipe.movement * 6, preDelay: 0.08, wet: 0.28 + recipe.movement * 0.28 })
      const chorus = new Tone.Chorus({ frequency: 0.08 + recipe.movement * 0.18, delayTime: 3.5, depth: 0.22 + recipe.movement * 0.22, wet: 0.18 }).start()
      const filter = new Tone.Filter({
        type: "lowpass",
        frequency: 700 + recipe.brightness * 4_800,
        rolloff: -24,
        Q: 0.7,
      })
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.5,
        modulationIndex: 1.2 + recipe.brightness * 2.8,
        oscillator: { type: recipe.preset === "cold_suspense" ? "sine" : "fatsine" },
        envelope: { attack: 1.4, decay: 0.8, sustain: 0.72, release: 5.5 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 2.2, decay: 0.6, sustain: 0.35, release: 4 },
      })
      const bell = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.015, decay: 1.2, sustain: 0.05, release: 2.8 },
      })
      synth.chain(filter, chorus, reverb, compressor, output, Tone.getDestination())
      bell.chain(reverb, compressor, output)
      await reverb.generate()
      this.output = output
      this.synth = synth
      this.bell = bell
      this.nodes = [filter, chorus, reverb, compressor, output]
      this.cue = cue

      const scale = SCALE[recipe.scale]
      const progression = PROGRESSIONS[recipe.preset]
      let bar = 0
      const playBar = (time: number) => {
        const degree = progression[bar % progression.length] % scale.length
        const root = recipe.rootMidi + scale[degree]
        const third = recipe.rootMidi + scale[(degree + 2) % scale.length] + (degree + 2 >= scale.length ? 12 : 0)
        const fifth = recipe.rootMidi + scale[(degree + 4) % scale.length] + (degree + 4 >= scale.length ? 12 : 0)
        synth.triggerAttackRelease([root, third, fifth], "1m", time, 0.28 + recipe.density * 0.25)
        if (seeded(recipe.seed, bar) < recipe.density * 0.75) {
          const note = recipe.rootMidi + 12 + scale[Math.floor(seeded(recipe.seed + 17, bar) * scale.length)]
          bell.triggerAttackRelease(note, "2n", time + Tone.Time("2n").toSeconds(), 0.12 + recipe.brightness * 0.16)
        }
        bar = (bar + 1) % Math.max(2, recipe.bars)
      }
      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      transport.bpm.value = recipe.bpm
      this.loop = new Tone.Loop(playBar, "1m").start(0)
      transport.start()
      output.gain.rampTo(this.targetVolume(), Math.max(0.35, cue.crossfadeSeconds))
      this.setState("playing", cue)
    } catch (error) {
      console.error("Procedural audio failed:", error)
      this.stopRuntime()
      this.setState("error", cue)
    }
  }

  setMasterVolume(value: number) { this.master = Math.max(0, Math.min(1, value)); this.applyVolume() }
  setDucked(value: boolean) { this.duckFactor = value ? 0.16 : 1; this.applyVolume() }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number) {
    this.narrativeGain = silence ? 0.08 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    this.output?.gain.rampTo(this.targetVolume(), Math.max(0.25, seconds))
  }
  pause() { this.tone?.getTransport().pause(); this.setState("paused", this.cue) }
  async resume() { if (!this.tone || !this.cue) return; await this.tone.start(); this.tone.getTransport().start(); this.setState("playing", this.cue) }
  stop() { this.stopRuntime(); this.cue = null; this.setState("idle", null) }
  dispose() { this.stop() }

  private targetVolume() { return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain)) }
  private applyVolume() { this.output?.gain.rampTo(this.targetVolume(), 0.18) }
  private stopRuntime() {
    this.loop?.dispose?.()
    this.loop = null
    this.tone?.getTransport().stop()
    this.tone?.getTransport().cancel()
    this.synth?.releaseAll?.()
    this.synth?.dispose?.()
    this.bell?.releaseAll?.()
    this.bell?.dispose?.()
    for (const node of this.nodes) node?.dispose?.()
    this.nodes = []
    this.synth = null
    this.bell = null
    this.output = null
  }
  private setState(state: MusicState, cue: MusicCue | null) { this.listener(state, cue) }
}
