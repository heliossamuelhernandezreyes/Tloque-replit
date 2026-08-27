import { proceduralRecipeFor, type ProceduralRecipe } from "@shared/audio"
import {
  compileMusicBrainScore,
  musicBrainDwellPhaseForCycle,
  musicBrainNoteForDwellCycle,
  musicBrainScoreForProceduralRecipe,
  notesForMusicBrainRegion,
  type MusicBrainCompilationV1,
  type MusicBrainNoteEventV1,
  type MusicBrainScoreV1,
} from "@shared/music-brain"
import type { MusicCue, MusicState } from "./MusicEngine"
import { midiNoteToFrequency } from "./ScoreAudioMath"

type Listener = (state: MusicState, cue: MusicCue | null) => void

function transportPosition(beat: number, beatsPerBar: number): string {
  const safeBeat = Math.max(0, beat)
  const bar = Math.floor(safeBeat / beatsPerBar)
  const insideBar = safeBeat - bar * beatsPerBar
  const quarter = Math.floor(insideBar)
  const sixteenth = Math.round((insideBar - quarter) * 4 * 1_000) / 1_000
  return `${bar}:${quarter}:${sixteenth}`
}

function nextBarPosition(transport: any): string {
  const signature = transport.timeSignature
  const beatsPerBar = Array.isArray(signature) ? signature[0] * 4 / signature[1] : signature
  const ticksPerBar = Math.max(1, Math.round(transport.PPQ * beatsPerBar))
  const nextTicks = Math.ceil((Math.max(0, transport.ticks) + 1) / ticksPerBar) * ticksPerBar
  return `${nextTicks}i`
}

export class ProceduralMusicEngine {
  private tone: typeof import("tone") | null = null
  private cue: MusicCue | null = null
  private master = 0.35
  private duckFactor = 1
  private narrativeGain = 1
  private loop: any = null
  private retiredParts: any[] = []
  private synth: any = null
  private bell: any = null
  private nodes: any[] = []
  private output: any = null
  private score: MusicBrainScoreV1 | null = null
  private recipe: ProceduralRecipe | null = null
  private compilation: MusicBrainCompilationV1 | null = null
  private activeRegionId: string | null = null
  private requestedRegionId: string | null = null
  private transitionSeconds = 8

  constructor(private readonly listener: Listener) {}

  async play(cue: MusicCue) {
    this.setState("loading", cue)
    try {
      this.stopRuntime()
      const Tone = this.tone ?? await import("tone")
      this.tone = Tone
      await Tone.start()
      const recipe = proceduralRecipeFor(cue.recipe)
      this.recipe = recipe
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
      this.compilation = compileMusicBrainScore(this.score ?? musicBrainScoreForProceduralRecipe(recipe))
      const transport = Tone.getTransport()
      transport.stop()
      transport.cancel()
      const firstRegion = this.compilation.plan.regions.find(region => region.regionId === this.requestedRegionId)
        ?? this.compilation.plan.regions[0]
      transport.bpm.value = firstRegion.bpm
      transport.timeSignature = firstRegion.meter[0]
      this.startRegion(firstRegion.regionId, true)
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
  setNarrativeScore(score: MusicBrainScoreV1 | null) {
    this.score = score
    if (!score) this.requestedRegionId = null
    const effectiveScore = score ?? (this.recipe ? musicBrainScoreForProceduralRecipe(this.recipe) : null)
    if (!effectiveScore || !this.tone || !this.cue) return
    this.compilation = compileMusicBrainScore(effectiveScore)
    const region = this.compilation.plan.regions.find(candidate => candidate.regionId === this.requestedRegionId)
      ?? this.compilation.plan.regions[0]
    this.startRegion(region.regionId, false)
  }
  setNarrativeDirection(intensity: number, silence: boolean, seconds: number, regionId?: string) {
    this.narrativeGain = silence ? 0 : 0.72 + Math.max(0, Math.min(0.8, intensity)) * 0.35
    this.transitionSeconds = Math.max(0.25, Math.min(30, seconds))
    this.output?.gain.rampTo(this.targetVolume(), Math.max(0.25, seconds))
    if (regionId) this.requestedRegionId = regionId
    if (regionId && regionId !== this.activeRegionId) this.startRegion(regionId, false)
  }
  pause() { this.tone?.getTransport().pause(); this.setState("paused", this.cue) }
  async resume() { if (!this.tone || !this.cue) return; await this.tone.start(); this.tone.getTransport().start(); this.setState("playing", this.cue) }
  stop() { this.stopRuntime(); this.cue = null; this.setState("idle", null) }
  dispose() { this.stop() }

  private targetVolume() { return Math.max(0, Math.min(1, this.master * (this.cue?.volume ?? 1) * this.duckFactor * this.narrativeGain)) }
  private applyVolume() { this.output?.gain.rampTo(this.targetVolume(), 0.18) }
  private startRegion(regionId: string, immediate: boolean) {
    if (!this.tone || !this.compilation) return
    const region = this.compilation.plan.regions.find(candidate => candidate.regionId === regionId)
    if (!region) return
    const transport = this.tone.getTransport()
    const when = immediate ? 0 : nextBarPosition(transport)
    if (this.loop) {
      this.loop.stop(when)
      this.retiredParts.push(this.loop)
      this.loop = null
    }
    transport.bpm.rampTo(region.bpm, immediate ? 0 : Math.max(1, this.transitionSeconds))
    transport.timeSignature = region.meter[0]
    this.activeRegionId = region.regionId
    if (region.silence) return
    const notes = notesForMusicBrainRegion(this.compilation.timeline, region.regionId)
    const relativeEvents: Array<[string, MusicBrainNoteEventV1]> = notes.map(event => [
      transportPosition(event.beat - region.startBeat, region.meter[0]),
      event,
    ])
    let firstLoopStartTick: number | null = null
    const part = new this.tone.Part<[string, MusicBrainNoteEventV1]>((time: number, event) => {
      const relativeBeat = event.beat - region.startBeat
      const loopStartTick = transport.getTicksAtTime(time) - relativeBeat * transport.PPQ
      if (firstLoopStartTick === null) firstLoopStartTick = loopStartTick
      const loopTicks = Math.max(1, region.durationBeats * transport.PPQ)
      const dwellCycle = Math.max(0, Math.round((loopStartTick - firstLoopStartTick) / loopTicks))
      const phase = musicBrainDwellPhaseForCycle(region, dwellCycle)
      const adapted = musicBrainNoteForDwellCycle(event, phase, dwellCycle)
      if (!adapted) return
      const instrument = adapted.voice === "foundation" ? this.synth : this.bell
      const durationSeconds = adapted.durationBeats * 60 / region.bpm
      instrument?.triggerAttackRelease(midiNoteToFrequency(adapted.midi), durationSeconds, time, adapted.velocity)
    }, relativeEvents)
    part.loop = true
    part.loopEnd = transportPosition(region.durationBeats, region.meter[0])
    part.start(when)
    this.loop = part
  }
  private stopRuntime() {
    this.loop?.dispose?.()
    this.loop = null
    for (const part of this.retiredParts) part?.dispose?.()
    this.retiredParts = []
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
    this.compilation = null
    this.recipe = null
    this.activeRegionId = null
  }
  private setState(state: MusicState, cue: MusicCue | null) { this.listener(state, cue) }
}
