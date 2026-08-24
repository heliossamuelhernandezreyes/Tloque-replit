import type { NativePhysicalModelSource } from "@shared/native-acoustic-source"
import type { LinearScoreRecipeV2, LinearScoreTrackV2 } from "@shared/tloque-score-v2"
import { analyzePhysicalModelProbe } from "./PhysicalModelValidation"
import { schedulePhysicalReedVoice } from "./PhysicalReedModel"

type LinearScoreEventV2 = LinearScoreRecipeV2["plan"]["events"][number]

function midiHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12) }

function trackFor(source: NativePhysicalModelSource): LinearScoreTrackV2 {
  return {
    id: "probe", synth: "warm", instrument: source.instrumentId, program: 68, role: "melody",
    gain: 0.7, pan: 0, attack: 0.06, release: 0.35, expression: 0.72, brightness: 0.5, vibrato: 0.08, timbre: "natural",
  }
}

function eventAt(midi: number, timeSeconds: number, durationSeconds: number, velocity: number, articulation: LinearScoreEventV2["articulation"]): LinearScoreEventV2 {
  return {
    trackId: "probe", sectionId: "probe", bar: 1, beat: 1, timeBeats: timeSeconds, timeSeconds,
    durationBeats: durationSeconds, durationSeconds, notes: [midi], velocity, articulation, timbre: "natural",
  }
}

async function renderSingle(source: NativePhysicalModelSource, midi: number, velocity: number, articulation: LinearScoreEventV2["articulation"], duration = 1.35) {
  if (typeof OfflineAudioContext === "undefined") throw new Error("OfflineAudioContext no disponible en este entorno")
  const sampleRate = 48_000
  const context = new OfflineAudioContext(1, Math.ceil(sampleRate * (duration + 0.6)), sampleRate)
  const event = eventAt(midi, 0.08, duration, velocity, articulation)
  schedulePhysicalReedVoice(context, source, { startAt: 0, event, track: trackFor(source), midi, destination: context.destination })
  const rendered = await context.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}

async function renderLegato(source: NativePhysicalModelSource, midi: number) {
  if (typeof OfflineAudioContext === "undefined") throw new Error("OfflineAudioContext no disponible en este entorno")
  const sampleRate = 48_000
  const firstStart = 0.08, secondStart = 0.78
  const context = new OfflineAudioContext(1, Math.ceil(sampleRate * 2.1), sampleRate)
  const track = trackFor(source)
  const first = eventAt(midi, firstStart, 0.78, 0.58, "legato")
  const secondMidi = Math.min(source.midiMax, midi + 2)
  const second = eventAt(secondMidi, secondStart, 0.82, 0.6, "legato")
  schedulePhysicalReedVoice(context, source, { startAt: 0, event: first, track, midi, destination: context.destination })
  schedulePhysicalReedVoice(context, source, { startAt: 0, event: second, track, midi: secondMidi, destination: context.destination, legatoFromPrevious: true })
  const rendered = await context.startRendering()
  return { pcm: new Float32Array(rendered.getChannelData(0)), boundaryFrame: Math.round(secondStart * sampleRate) }
}

/**
 * Renders the model through a deterministic calibration protocol. The resulting
 * report is objective evidence only; it deliberately cannot self-approve Master.
 */
export async function runPhysicalModelCalibration(source: NativePhysicalModelSource) {
  const midi = Math.round((source.midiMin + source.midiMax) / 2)
  const [soft, loud, sustained, attack, legato] = await Promise.all([
    renderSingle(source, midi, 0.24, "normal"),
    renderSingle(source, midi, 0.88, "normal"),
    renderSingle(source, midi, 0.58, "tenuto", 1.55),
    renderSingle(source, midi, 0.62, "accent", 0.9),
    renderLegato(source, midi),
  ])
  return analyzePhysicalModelProbe(source, {
    sampleRate: 48_000,
    targetFrequencyHz: midiHz(midi),
    soft,
    loud,
    sustained,
    attack,
    legato: legato.pcm,
    legatoBoundaryFrame: legato.boundaryFrame,
  })
}
