import { z } from "zod"
import {
  DEFAULT_TLOQUE_SCORE_V2, TLOQUE_SCORE_COMPILER_V2, compileTloqueScoreV2,
  linearScoreRecipeV2Schema, type LinearScoreControlV2, type LinearScoreRecipeV2, type LinearScoreTrackV2,
} from "./tloque-score-v2"
export {
  DEFAULT_TLOQUE_SCORE_V2, TLOQUE_SCORE_COMPILER_V2, TLOQUE_SCORE_COMPILER_V2_LEGACY, compileTloqueScoreV2,
  linearScoreControlV2Schema, linearScorePlanV2Schema, linearScoreRecipeV2Schema,
  type LinearScoreControlV2, type LinearScorePlanV2, type LinearScoreRecipeV2, type LinearScoreTrackV2,
} from "./tloque-score-v2"

export const AUDIO_CONTRACT_VERSION = "tloque-audio-2026-08-v2" as const
export const TLOQUE_SCORE_COMPILER_V1 = "tloque-score-compiler-v1" as const
export const TLOQUE_SCORE_COMPILER_VERSION = TLOQUE_SCORE_COMPILER_V2

export const audioSourceTypeSchema = z.enum(["stream", "procedural", "soundfont", "score", "sfx"])
export type AudioSourceType = z.infer<typeof audioSourceTypeSchema>

export const proceduralPresetSchema = z.enum([
  "quiet_observatory",
  "warm_memory",
  "cold_suspense",
  "deep_focus",
])

export const proceduralRecipeSchema = z.object({
  version: z.literal(1).default(1),
  preset: proceduralPresetSchema.default("quiet_observatory"),
  rootMidi: z.number().int().min(36).max(72).default(48),
  scale: z.enum(["major", "minor", "dorian", "pentatonic"]).default("minor"),
  bpm: z.number().int().min(32).max(140).default(58),
  bars: z.number().int().min(2).max(16).default(4),
  density: z.number().min(0).max(1).default(0.35),
  brightness: z.number().min(0).max(1).default(0.45),
  movement: z.number().min(0).max(1).default(0.3),
  seed: z.number().int().min(0).max(2_147_483_647).default(1),
}).strict()

export type ProceduralRecipe = z.infer<typeof proceduralRecipeSchema>

export const DEFAULT_PROCEDURAL_RECIPE: ProceduralRecipe = proceduralRecipeSchema.parse({})

export function proceduralRecipeFor(value: unknown): ProceduralRecipe {
  return proceduralRecipeSchema.parse(value ?? {})
}

// ── TLOQUE SCORE V1 · PARTITURA LINEAL INSTRUMENTAL ────────

export const linearSynthSchema = z.enum(["warm", "pad", "bell", "pluck", "bass"])

export const linearScoreTrackSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/),
  synth: linearSynthSchema,
  gain: z.number().min(0).max(1),
  pan: z.number().min(-1).max(1),
}).strict()

export const linearScoreEventSchema = z.object({
  trackId: z.string(),
  bar: z.number().int().min(1).max(32),
  beat: z.number().min(1).max(16),
  timeBeats: z.number().min(0).max(256),
  durationBeats: z.number().min(0.0625).max(32),
  notes: z.array(z.number().int().min(24).max(108)).min(1).max(6),
  velocity: z.number().min(0.02).max(1),
}).strict()

export const linearScorePlanSchema = z.object({
  version: z.literal(1),
  compilerVersion: z.literal(TLOQUE_SCORE_COMPILER_V1),
  sourceHash: z.string().regex(/^[a-f0-9]{8}$/),
  bpm: z.number().int().min(32).max(180),
  meter: z.object({ numerator: z.number().int().min(2).max(12), denominator: z.union([z.literal(4), z.literal(8)]) }).strict(),
  loop: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647),
  totalBars: z.number().int().min(1).max(32),
  totalBeats: z.number().min(1).max(384),
  tracks: z.array(linearScoreTrackSchema).min(1).max(8),
  events: z.array(linearScoreEventSchema).min(1).max(512),
}).strict()

export const linearScoreRecipeSchema = z.object({
  version: z.literal(1),
  language: z.literal("tloque-score"),
  source: z.string().min(1).max(40_000),
  plan: linearScorePlanSchema,
}).strict()

export const anyLinearScoreRecipeSchema = z.union([linearScoreRecipeSchema, linearScoreRecipeV2Schema])

export type LinearScorePlan = z.infer<typeof linearScorePlanSchema> | LinearScoreRecipeV2["plan"]
export type LinearScoreRecipe = z.infer<typeof linearScoreRecipeSchema> | LinearScoreRecipeV2
export type LinearScoreTrack = z.infer<typeof linearScoreTrackSchema> | LinearScoreTrackV2
export type LinearScoreControl = LinearScoreControlV2

export interface TloqueScoreDiagnostic {
  line: number
  message: string
}

export type TloqueScoreCompileResult =
  | { ok: true; recipe: LinearScoreRecipe; diagnostics: [] }
  | { ok: false; diagnostics: TloqueScoreDiagnostic[] }

export const DEFAULT_TLOQUE_SCORE_V1 = `TLOQUE_SCORE 1
tempo 68
meter 4/4
loop true
seed 202608

track pad synth=pad gain=0.34 pan=0
1:1 C3,Eb3,G3 4 velocity=0.58
2:1 Ab2,C3,Eb3 4 velocity=0.52
3:1 Eb3,G3,Bb3 4 velocity=0.55
4:1 Bb2,D3,F3 4 velocity=0.50

track motif synth=bell gain=0.18 pan=0.12
1:3 G4 0.75 velocity=0.42
2:3 Ab4 0.75 velocity=0.38
3:3 Bb4 0.75 velocity=0.42
4:3 F4 0.75 velocity=0.36`

export const DEFAULT_TLOQUE_SCORE = DEFAULT_TLOQUE_SCORE_V2

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function midiFor(note: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-1|[0-8])$/.exec(note)
  if (!match) return null
  const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pitch = semitones[match[1].toUpperCase()]
  if (match[2] === "#") pitch += 1
  if (match[2] === "b") pitch -= 1
  const midi = (Number(match[3]) + 1) * 12 + pitch
  return midi >= 24 && midi <= 108 ? midi : null
}

function keyValues(parts: string[]): Record<string, string> {
  return Object.fromEntries(parts.map(part => {
    const equals = part.indexOf("=")
    return equals > 0 ? [part.slice(0, equals), part.slice(equals + 1)] : [part, ""]
  }))
}

export function compileTloqueScore(source: string): TloqueScoreCompileResult {
  if (source.replace(/\r/g, "").trimStart().startsWith("TLOQUE_SCORE 2")) {
    return compileTloqueScoreV2(source)
  }
  const diagnostics: TloqueScoreDiagnostic[] = []
  const clean = source.replace(/\r/g, "").trim()
  const lines = clean.split("\n")
  let bpm = 68
  let numerator = 4
  let denominator: 4 | 8 = 4
  let loop = true
  let seed = 1
  let currentTrack: z.infer<typeof linearScoreTrackSchema> | null = null
  const tracks: z.infer<typeof linearScoreTrackSchema>[] = []
  const events: z.infer<typeof linearScoreEventSchema>[] = []
  const ids = new Set<string>()

  if (lines[0]?.trim() !== "TLOQUE_SCORE 1") {
    diagnostics.push({ line: 1, message: "La primera línea debe ser TLOQUE_SCORE 1" })
  }

  const add = (line: number, message: string) => diagnostics.push({ line, message })
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index].replace(/\s+\/\/.*$/, "").trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    const command = parts[0]

    if (command === "tempo") {
      const value = Number(parts[1])
      if (!Number.isInteger(value) || value < 32 || value > 180) add(lineNumber, "tempo admite un entero entre 32 y 180")
      else bpm = value
      continue
    }
    if (command === "meter") {
      const match = /^(\d{1,2})\/(4|8)$/.exec(parts[1] || "")
      if (!match || Number(match[1]) < 2 || Number(match[1]) > 12) add(lineNumber, "meter admite compases entre 2/4 y 12/8")
      else { numerator = Number(match[1]); denominator = Number(match[2]) as 4 | 8 }
      continue
    }
    if (command === "loop") {
      if (!/^(true|false)$/.test(parts[1] || "")) add(lineNumber, "loop debe ser true o false")
      else loop = parts[1] === "true"
      continue
    }
    if (command === "seed") {
      const value = Number(parts[1])
      if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) add(lineNumber, "seed debe ser un entero entre 0 y 2147483647")
      else seed = value
      continue
    }
    if (command === "track") {
      const id = parts[1] || ""
      const values = keyValues(parts.slice(2))
      const synth = values.synth
      const gain = values.gain === undefined ? 0.35 : Number(values.gain)
      const pan = values.pan === undefined ? 0 : Number(values.pan)
      const candidate = linearScoreTrackSchema.safeParse({ id, synth, gain, pan })
      if (!candidate.success) add(lineNumber, "track: usa id, synth=warm|pad|bell|pluck|bass, gain=0..1 y pan=-1..1")
      else if (ids.has(id)) add(lineNumber, `El track ${id} ya existe`)
      else {
        currentTrack = candidate.data
        tracks.push(currentTrack)
        ids.add(id)
      }
      continue
    }

    const position = /^(\d{1,2}):(\d+(?:\.\d+)?)$/.exec(command)
    if (position) {
      if (!currentTrack) { add(lineNumber, "Declara un track antes de escribir notas"); continue }
      const bar = Number(position[1])
      const beat = Number(position[2])
      const durationBeats = Number(parts[2])
      const values = keyValues(parts.slice(3))
      const velocity = values.velocity === undefined ? 0.5 : Number(values.velocity)
      const notes = (parts[1] || "").split(",").map(midiFor)
      if (notes.some(note => note === null)) { add(lineNumber, "Notas inválidas; usa C3, F#4 o Bb2 separadas por coma"); continue }
      if (!Number.isInteger(bar) || bar < 1 || bar > 32 || beat < 1 || beat > numerator) { add(lineNumber, `La posición debe caer entre 1:1 y 32:${numerator}`); continue }
      const beatUnit = 4 / denominator
      const timeBeats = (bar - 1) * numerator * beatUnit + (beat - 1) * beatUnit
      const event = linearScoreEventSchema.safeParse({
        trackId: currentTrack.id, bar, beat, timeBeats, durationBeats,
        notes: notes as number[], velocity,
      })
      if (!event.success) add(lineNumber, "Evento inválido: duración 0.0625..32, hasta 6 notas y velocity 0.02..1")
      else events.push(event.data)
      continue
    }
    add(lineNumber, `Comando desconocido: ${command}`)
  }

  if (tracks.length === 0) diagnostics.push({ line: 1, message: "La partitura necesita al menos un track" })
  if (tracks.length > 8) diagnostics.push({ line: 1, message: "La partitura admite como máximo 8 tracks" })
  if (events.length === 0) diagnostics.push({ line: 1, message: "La partitura necesita al menos una nota" })
  if (events.length > 512) diagnostics.push({ line: 1, message: "La partitura admite como máximo 512 eventos" })
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.slice(0, 40) }

  events.sort((left, right) => left.timeBeats - right.timeBeats || left.trackId.localeCompare(right.trackId))
  const totalBars = Math.max(...events.map(event => event.bar))
  const totalBeats = totalBars * numerator * (4 / denominator)
  const plan = linearScorePlanSchema.parse({
    version: 1,
    compilerVersion: TLOQUE_SCORE_COMPILER_V1,
    sourceHash: fnv1a(clean),
    bpm, meter: { numerator, denominator }, loop, seed, totalBars, totalBeats, tracks, events,
  })
  return {
    ok: true,
    diagnostics: [],
    recipe: linearScoreRecipeSchema.parse({ version: 1, language: "tloque-score", source: clean, plan }),
  }
}

export function linearScoreRecipeFor(value: unknown): LinearScoreRecipe {
  return anyLinearScoreRecipeSchema.parse(value)
}

// ── MICROSONIDOS DE INTERFAZ ───────────────────────────────

export const UI_SOUND_EVENTS = [
  { key: "ui.orb.tap", label: "Orbe · toque" },
  { key: "ui.orb.hold", label: "Orbe · pulsación larga" },
  { key: "ui.genre.cycle.todos", label: "Género · general" },
  { key: "ui.genre.cycle.melancolico", label: "Género · melancólico" },
  { key: "ui.genre.cycle.terror", label: "Género · terror" },
  { key: "ui.genre.cycle.fantasia", label: "Género · fantasía" },
  { key: "ui.genre.cycle.misterio", label: "Género · misterio" },
  { key: "ui.genre.cycle.romance", label: "Género · romance" },
  { key: "ui.genre.reset", label: "Género · restablecer" },
  { key: "ui.book.save", label: "Libro · guardar" },
  { key: "ui.page.turn", label: "Lectura · cambio de página" },
  { key: "ui.navigation", label: "Navegación" },
  { key: "ui.book.complete", label: "Libro · completado" },
  { key: "ui.streak.milestone", label: "Racha · hito" },
  { key: "ui.action.success", label: "Acción · éxito" },
  { key: "ui.action.error", label: "Acción · error" },
  { key: "ui.modal.open", label: "Modal · abrir" },
  { key: "ui.notification", label: "Notificación" },
] as const

export type UiSoundEventKey = typeof UI_SOUND_EVENTS[number]["key"]
export const uiSoundEventKeySchema = z.enum(UI_SOUND_EVENTS.map(event => event.key) as [UiSoundEventKey, ...UiSoundEventKey[]])

export const uiSoundVoiceSchema = z.object({
  wave: z.enum(["sine", "triangle", "square", "sawtooth", "noise"]).default("sine"),
  startHz: z.number().min(35).max(8_000).default(440),
  endHz: z.number().min(35).max(8_000).nullable().default(null),
  offset: z.number().min(0).max(3.5).default(0),
  duration: z.number().min(0.02).max(4).default(0.2),
  attack: z.number().min(0.001).max(1).default(0.005),
  release: z.number().min(0.005).max(3).default(0.16),
  gain: z.number().min(0.001).max(0.35).default(0.08),
}).strict().superRefine((voice, ctx) => {
  if (voice.attack + voice.release > voice.duration + 0.02) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ataque y salida exceden la duración" })
  }
})

export const uiSoundRecipeSchema = z.object({
  version: z.literal(1).default(1),
  seed: z.number().int().min(0).max(2_147_483_647).default(1),
  filter: z.object({
    type: z.enum(["lowpass", "highpass", "bandpass"]).default("lowpass"),
    frequency: z.number().min(80).max(12_000).default(5_000),
    q: z.number().min(0.1).max(18).default(0.7),
  }).strict().default({ type: "lowpass", frequency: 5_000, q: 0.7 }),
  voices: z.array(uiSoundVoiceSchema).min(1).max(8),
}).strict()

export type UiSoundRecipe = z.infer<typeof uiSoundRecipeSchema>

export const DEFAULT_UI_SOUND_RECIPE: UiSoundRecipe = uiSoundRecipeSchema.parse({
  voices: [{ wave: "sine", startHz: 680, endHz: 1020, duration: 0.28, attack: 0.004, release: 0.24, gain: 0.08 }],
})

export function uiSoundRecipeFor(value: unknown): UiSoundRecipe {
  return uiSoundRecipeSchema.parse(value)
}

export const audioRecipeSchema = z.union([proceduralRecipeSchema, linearScoreRecipeSchema, linearScoreRecipeV2Schema, uiSoundRecipeSchema])
export type AudioRecipe = z.infer<typeof audioRecipeSchema>

export interface UiSoundManifestBinding {
  eventKey: UiSoundEventKey
  volume: number
  cooldownMs: number
  asset: {
    id: number
    title: string
    sourceType: "stream" | "sfx"
    url: string
    recipe: UiSoundRecipe | null
  }
}

export interface UiSoundManifest {
  version: typeof AUDIO_CONTRACT_VERSION
  bindings: UiSoundManifestBinding[]
}
