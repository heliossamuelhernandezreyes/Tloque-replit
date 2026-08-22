import { z } from "zod"

export const TLOQUE_SCORE_COMPILER_V2 = "tloque-score-compiler-v2" as const

const synthSchema = z.enum(["warm", "pad", "bell", "pluck", "bass"])
const qualitySchema = z.enum(["core", "studio", "master"])
const roleSchema = z.enum(["melody", "harmony", "bass", "pulse", "texture", "accent"])
const formSchema = z.enum(["exposition", "development", "recapitulation", "coda", "interlude", "custom"])

export const linearScoreTrackV2Schema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  synth: synthSchema,
  instrument: z.string().regex(/^[a-z][a-z0-9._-]{0,47}$/),
  program: z.number().int().min(0).max(127),
  role: roleSchema,
  gain: z.number().min(0).max(1),
  pan: z.number().min(-1).max(1),
  attack: z.number().min(0.001).max(8),
  release: z.number().min(0.01).max(12),
}).strict()

export const linearScoreEventV2Schema = z.object({
  trackId: z.string(),
  sectionId: z.string(),
  bar: z.number().int().min(1).max(256),
  beat: z.number().min(1).max(16),
  timeBeats: z.number().min(0).max(4_096),
  timeSeconds: z.number().min(0).max(3_600),
  durationBeats: z.number().min(0.03125).max(64),
  durationSeconds: z.number().min(0.01).max(120),
  notes: z.array(z.number().int().min(24).max(108)).min(1).max(12),
  velocity: z.number().min(0.01).max(1),
  articulation: z.enum(["normal", "legato", "staccato", "tenuto", "accent"]),
}).strict()

export const linearScoreRestV2Schema = z.object({
  trackId: z.string(),
  sectionId: z.string(),
  bar: z.number().int().min(1).max(256),
  beat: z.number().min(1).max(16),
  timeBeats: z.number().min(0).max(4_096),
  timeSeconds: z.number().min(0).max(3_600),
  durationBeats: z.number().min(0.03125).max(64),
  durationSeconds: z.number().min(0.01).max(120),
}).strict()

export const linearScoreSectionV2Schema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  form: formSchema,
  startBar: z.number().int().min(1).max(256),
  startSeconds: z.number().min(0).max(3_600),
  bpm: z.number().int().min(32).max(180),
  bars: z.number().int().min(1).max(128),
  repeat: z.number().int().min(1).max(4),
  fadeBeats: z.number().min(0).max(16),
}).strict()

export const linearScorePlanV2Schema = z.object({
  version: z.literal(2),
  compilerVersion: z.literal(TLOQUE_SCORE_COMPILER_V2),
  sourceHash: z.string().regex(/^[a-f0-9]{8}$/),
  title: z.string().max(160),
  bpm: z.number().int().min(32).max(180),
  meter: z.object({ numerator: z.number().int().min(2).max(12), denominator: z.union([z.literal(4), z.literal(8)]) }).strict(),
  loop: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647),
  quality: qualitySchema,
  moduleId: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  totalBars: z.number().int().min(1).max(256),
  totalBeats: z.number().min(1).max(4_096),
  totalSeconds: z.number().min(0.1).max(1_800),
  tracks: z.array(linearScoreTrackV2Schema).min(1).max(16),
  sections: z.array(linearScoreSectionV2Schema).min(1).max(32),
  events: z.array(linearScoreEventV2Schema).min(1).max(8_192),
  rests: z.array(linearScoreRestV2Schema).max(4_096),
}).strict()

export const linearScoreRecipeV2Schema = z.object({
  version: z.literal(2),
  language: z.literal("tloque-score"),
  source: z.string().min(1).max(200_000),
  plan: linearScorePlanV2Schema,
}).strict()

export type LinearScoreRecipeV2 = z.infer<typeof linearScoreRecipeV2Schema>
export type LinearScorePlanV2 = z.infer<typeof linearScorePlanV2Schema>
export type LinearScoreTrackV2 = z.infer<typeof linearScoreTrackV2Schema>

export interface TloqueScoreV2Diagnostic { line: number; message: string }
export type TloqueScoreV2CompileResult =
  | { ok: true; recipe: LinearScoreRecipeV2; diagnostics: [] }
  | { ok: false; diagnostics: TloqueScoreV2Diagnostic[] }

export const DEFAULT_TLOQUE_SCORE_V2 = `TLOQUE_SCORE 2
title "Sonata breve de Tloque"
tempo 72
meter 4/4
loop false
seed 20260822
quality master
module builtin

track piano synth=warm instrument=piano.grand program=0 role=harmony gain=0.34 pan=-0.08 attack=0.05 release=1.8
track violin synth=pad instrument=strings.violin program=40 role=melody gain=0.24 pan=0.14 attack=0.18 release=1.6
track cello synth=bass instrument=strings.cello program=42 role=bass gain=0.25 pan=-0.16 attack=0.08 release=1.4

section theme-a form=exposition bars=4 repeat=2 fade=1 tempo=72
use piano
1:1 C3,E3,G3 2 velocity=0.52
1:3 G3,C4,E4 2 velocity=0.48
2:1 F3,A3,C4 4 velocity=0.48
3:1 D3,F3,A3 2 velocity=0.50
3:3 G3,B3,D4 2 velocity=0.52
4:1 C3,E3,G3 4 velocity=0.48
use violin
1:1 E4 1 velocity=0.46 articulation=legato
1:2 G4 1 velocity=0.48 articulation=legato
1:3 C5 2 velocity=0.52
2:1 A4 2 velocity=0.47
2:3 G4 2 velocity=0.44
3:1 F4 1 velocity=0.46
3:2 A4 1 velocity=0.48
3:3 D5 2 velocity=0.53
4:1 B4 1 velocity=0.45
4:2 G4 1 velocity=0.42
4:3 E4 2 velocity=0.40
end

section transformation form=development bars=4 repeat=1 fade=2 tempo=84
use piano
1:1 A2,C3,E3 2 velocity=0.46
1:3 E3,A3,C4 2 velocity=0.48
2:1 D3,F3,A3 2 velocity=0.49
2:3 E3,G#3,B3 2 velocity=0.52
3:1 F3,A3,C4 4 velocity=0.50
4:1 G2,B2,D3 4 velocity=0.52
use cello
1:1 A2 4 velocity=0.42
2:1 D3 2 velocity=0.44
rest 2:3 2
3:1 F2 4 velocity=0.45
4:1 G2 4 velocity=0.47
use violin
1:1 C5 1 velocity=0.50 articulation=accent
1:2 B4 1 velocity=0.44
1:3 A4 2 velocity=0.48
2:1 F4 1 velocity=0.44
2:2 A4 1 velocity=0.48
2:3 B4 2 velocity=0.51
3:1 C5 2 velocity=0.52
3:3 A4 2 velocity=0.47
4:1 G4 4 velocity=0.45
end

section return-a form=recapitulation bars=4 repeat=1 fade=1 tempo=72
use piano
1:1 C3,E3,G3 4 velocity=0.54
2:1 F3,A3,C4 4 velocity=0.50
3:1 G3,B3,D4 4 velocity=0.52
4:1 C3,E3,G3 4 velocity=0.48
use violin
1:1 E4 1 velocity=0.48
1:2 G4 1 velocity=0.50
1:3 C5 2 velocity=0.55
2:1 A4 2 velocity=0.50
2:3 C5 2 velocity=0.53
3:1 B4 2 velocity=0.48
3:3 G4 2 velocity=0.44
4:1 E4 4 velocity=0.40 articulation=tenuto
end

section closing form=coda bars=2 repeat=1 fade=4 tempo=58
use cello
1:1 C3 4 velocity=0.40
2:1 C2 4 velocity=0.34
use piano
1:1 C3,G3,C4,E4 4 velocity=0.44
2:1 C3,E3,G3,C4 4 velocity=0.34 articulation=tenuto
end`

const DEFAULTS_BY_SYNTH = {
  warm: { instrument: "synth.warm", program: 0, attack: 0.12, release: 1.8 },
  pad: { instrument: "synth.pad", program: 48, attack: 1.1, release: 3.8 },
  bell: { instrument: "synth.bell", program: 8, attack: 0.008, release: 2.4 },
  pluck: { instrument: "synth.pluck", program: 24, attack: 0.003, release: 0.7 },
  bass: { instrument: "synth.bass", program: 32, attack: 0.02, release: 1.2 },
} as const

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

interface RawPosition { bar: number; beat: number; durationBeats: number; line: number }
interface RawEvent extends RawPosition { trackId: string; sectionId: string; notes: number[]; velocity: number; articulation: string }
interface RawRest extends RawPosition { trackId: string; sectionId: string }
interface RawSection { id: string; form: string; bars: number; repeat: number; fadeBeats: number; bpm: number; line: number }

export function compileTloqueScoreV2(source: string): TloqueScoreV2CompileResult {
  const diagnostics: TloqueScoreV2Diagnostic[] = []
  const clean = source.replace(/\r/g, "").trim()
  const lines = clean.split("\n")
  const add = (line: number, message: string) => diagnostics.push({ line, message })
  let title = ""
  let bpm = 72
  let numerator = 4
  let denominator: 4 | 8 = 4
  let loop = false
  let seed = 1
  let quality: z.infer<typeof qualitySchema> = "studio"
  let moduleId = "builtin"
  let currentTrackId = ""
  let currentSection: RawSection | null = null
  const tracks: z.infer<typeof linearScoreTrackV2Schema>[] = []
  const sections: RawSection[] = []
  const rawEvents: RawEvent[] = []
  const rawRests: RawRest[] = []
  const ids = new Set<string>()

  if (lines[0]?.trim() !== "TLOQUE_SCORE 2") add(1, "La primera línea debe ser TLOQUE_SCORE 2")

  const parsePosition = (value: string, line: number): { bar: number; beat: number } | null => {
    const match = /^(\d{1,3}):(\d+(?:\.\d+)?)$/.exec(value)
    if (!match) { add(line, "Usa una posición compás:tiempo, por ejemplo 3:2.5"); return null }
    return { bar: Number(match[1]), beat: Number(match[2]) }
  }

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index].replace(/\s+\/\/.*$/, "").trim()
    if (!line) continue
    const parts = line.match(/"[^"]*"|\S+/g) || []
    const command = parts[0] || ""

    if (command === "title") { title = parts.slice(1).join(" ").replace(/^"|"$/g, "").trim().slice(0, 160); continue }
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
    if (command === "quality") {
      const parsed = qualitySchema.safeParse(parts[1])
      if (!parsed.success) add(lineNumber, "quality debe ser core, studio o master")
      else quality = parsed.data
      continue
    }
    if (command === "module") {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(parts[1] || "")) add(lineNumber, "module usa un identificador corto, por ejemplo orchestra-core")
      else moduleId = parts[1]
      continue
    }
    if (command === "track") {
      if (currentSection) { add(lineNumber, "Declara los tracks antes de las secciones"); continue }
      const id = parts[1] || ""
      const values = keyValues(parts.slice(2))
      const synth = synthSchema.safeParse(values.synth)
      if (!synth.success) { add(lineNumber, "track necesita synth=warm|pad|bell|pluck|bass"); continue }
      const defaults = DEFAULTS_BY_SYNTH[synth.data]
      const candidate = linearScoreTrackV2Schema.safeParse({
        id,
        synth: synth.data,
        instrument: values.instrument || defaults.instrument,
        program: values.program === undefined ? defaults.program : Number(values.program),
        role: values.role || "harmony",
        gain: values.gain === undefined ? 0.35 : Number(values.gain),
        pan: values.pan === undefined ? 0 : Number(values.pan),
        attack: values.attack === undefined ? defaults.attack : Number(values.attack),
        release: values.release === undefined ? defaults.release : Number(values.release),
      })
      if (!candidate.success) add(lineNumber, "track inválido: revisa instrument, program=0..127, role, gain, pan, attack y release")
      else if (ids.has(id)) add(lineNumber, `El track ${id} ya existe`)
      else { tracks.push(candidate.data); ids.add(id); currentTrackId = id }
      continue
    }
    if (command === "section") {
      if (currentSection) { add(lineNumber, `Cierra la sección ${currentSection.id} con end`); continue }
      const id = parts[1] || ""
      const values = keyValues(parts.slice(2))
      const candidate: RawSection = {
        id,
        form: values.form || "custom",
        bars: Number(values.bars),
        repeat: values.repeat === undefined ? 1 : Number(values.repeat),
        fadeBeats: values.fade === undefined ? 0 : Number(values.fade),
        bpm: values.tempo === undefined ? bpm : Number(values.tempo),
        line: lineNumber,
      }
      const check = linearScoreSectionV2Schema.pick({ id: true, form: true, bars: true, repeat: true, fadeBeats: true, bpm: true }).safeParse({
        id: candidate.id, form: candidate.form, bars: candidate.bars, repeat: candidate.repeat, fadeBeats: candidate.fadeBeats, bpm: candidate.bpm,
      })
      if (!check.success || sections.some(section => section.id === id)) add(lineNumber, "section necesita id único, form, bars=1..128, repeat=1..4, fade=0..16 y tempo=32..180")
      else { currentSection = candidate; sections.push(candidate) }
      continue
    }
    if (command === "end") {
      if (!currentSection) add(lineNumber, "No hay una sección abierta")
      currentSection = null
      continue
    }
    if (command === "use") {
      if (!currentSection) add(lineNumber, "use sólo puede aparecer dentro de una sección")
      else if (!ids.has(parts[1] || "")) add(lineNumber, `El track ${parts[1] || ""} no existe`)
      else currentTrackId = parts[1]
      continue
    }
    if (command === "rest") {
      if (!currentSection || !currentTrackId) { add(lineNumber, "Declara una sección y elige un track antes del silencio"); continue }
      const position = parsePosition(parts[1] || "", lineNumber)
      if (!position) continue
      const durationBeats = Number(parts[2])
      if (position.bar < 1 || position.bar > currentSection.bars || position.beat < 1 || position.beat > numerator || !Number.isFinite(durationBeats) || durationBeats < 0.03125 || durationBeats > 64) {
        add(lineNumber, `El silencio debe caer dentro de ${currentSection.bars} compases y durar 0.03125..64 tiempos`)
      } else rawRests.push({ ...position, durationBeats, line: lineNumber, trackId: currentTrackId, sectionId: currentSection.id })
      continue
    }

    if (/^\d{1,3}:/.test(command)) {
      if (!currentSection || !currentTrackId) { add(lineNumber, "Declara una sección y elige un track antes de escribir notas"); continue }
      const position = parsePosition(command, lineNumber)
      if (!position) continue
      const notes = (parts[1] || "").split(",").map(midiFor)
      const durationBeats = Number(parts[2])
      const values = keyValues(parts.slice(3))
      const velocity = values.velocity === undefined ? 0.5 : Number(values.velocity)
      const articulation = values.articulation || "normal"
      if (notes.some(note => note === null)) add(lineNumber, "Notas inválidas; usa C3, F#4 o Bb2 separadas por coma")
      else if (position.bar < 1 || position.bar > currentSection.bars || position.beat < 1 || position.beat > numerator) add(lineNumber, `La nota debe caer dentro de ${currentSection.bars} compases y ${numerator} tiempos`)
      else {
        const candidate = linearScoreEventV2Schema.pick({ durationBeats: true, notes: true, velocity: true, articulation: true }).safeParse({ durationBeats, notes, velocity, articulation })
        if (!candidate.success) add(lineNumber, "Evento inválido: duración 0.03125..64, hasta 12 notas, velocity 0.01..1 y articulación conocida")
        else rawEvents.push({ ...position, durationBeats, notes: notes as number[], velocity, articulation, line: lineNumber, trackId: currentTrackId, sectionId: currentSection.id })
      }
      continue
    }
    add(lineNumber, `Comando desconocido: ${command}`)
  }

  if (currentSection) add(currentSection.line, `Falta end para la sección ${currentSection.id}`)
  if (!tracks.length) add(1, "La partitura necesita al menos un track")
  if (tracks.length > 16) add(1, "La partitura admite como máximo 16 tracks")
  if (!sections.length) add(1, "La partitura necesita al menos una sección")
  if (!rawEvents.length) add(1, "La partitura necesita al menos una nota")
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.slice(0, 60) }

  const beatUnit = 4 / denominator
  const beatsPerBar = numerator * beatUnit
  let barOffset = 0
  let secondsOffset = 0
  const compiledSections: z.infer<typeof linearScoreSectionV2Schema>[] = []
  const events: z.infer<typeof linearScoreEventV2Schema>[] = []
  const rests: z.infer<typeof linearScoreRestV2Schema>[] = []
  for (const section of sections) {
    compiledSections.push({ id: section.id, form: section.form as z.infer<typeof formSchema>, startBar: barOffset + 1, startSeconds: secondsOffset, bpm: section.bpm, bars: section.bars, repeat: section.repeat, fadeBeats: section.fadeBeats })
    const sectionEvents = rawEvents.filter(event => event.sectionId === section.id)
    const sectionRests = rawRests.filter(rest => rest.sectionId === section.id)
    for (let repeat = 0; repeat < section.repeat; repeat += 1) {
      const repeatOffset = barOffset + repeat * section.bars
      const repeatSeconds = secondsOffset + repeat * section.bars * beatsPerBar * 60 / section.bpm
      for (const event of sectionEvents) {
        const bar = repeatOffset + event.bar
        const localBeats = (event.bar - 1) * beatsPerBar + (event.beat - 1) * beatUnit
        events.push({
          trackId: event.trackId, sectionId: section.id, bar, beat: event.beat,
          timeBeats: (bar - 1) * beatsPerBar + (event.beat - 1) * beatUnit,
          timeSeconds: repeatSeconds + localBeats * 60 / section.bpm,
          durationBeats: event.durationBeats, durationSeconds: event.durationBeats * 60 / section.bpm, notes: event.notes, velocity: event.velocity,
          articulation: event.articulation as z.infer<typeof linearScoreEventV2Schema>["articulation"],
        })
      }
      for (const rest of sectionRests) {
        const bar = repeatOffset + rest.bar
        const localBeats = (rest.bar - 1) * beatsPerBar + (rest.beat - 1) * beatUnit
        rests.push({ trackId: rest.trackId, sectionId: section.id, bar, beat: rest.beat, timeBeats: (bar - 1) * beatsPerBar + (rest.beat - 1) * beatUnit, timeSeconds: repeatSeconds + localBeats * 60 / section.bpm, durationBeats: rest.durationBeats, durationSeconds: rest.durationBeats * 60 / section.bpm })
      }
    }
    barOffset += section.bars * section.repeat
    secondsOffset += section.bars * section.repeat * beatsPerBar * 60 / section.bpm
  }

  if (barOffset > 256) add(1, "La partitura compilada supera 256 compases")
  if (events.length > 8_192) add(1, "La partitura compilada supera 8192 eventos")
  const totalBeats = barOffset * beatsPerBar
  const totalSeconds = secondsOffset
  if (totalSeconds > 1_800) add(1, "La partitura supera 30 minutos; divídela en movimientos")
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.slice(0, 60) }

  events.sort((left, right) => left.timeBeats - right.timeBeats || left.trackId.localeCompare(right.trackId))
  rests.sort((left, right) => left.timeBeats - right.timeBeats || left.trackId.localeCompare(right.trackId))
  const plan = linearScorePlanV2Schema.parse({
    version: 2, compilerVersion: TLOQUE_SCORE_COMPILER_V2, sourceHash: fnv1a(clean), title,
    bpm, meter: { numerator, denominator }, loop, seed, quality, moduleId,
    totalBars: barOffset, totalBeats, totalSeconds, tracks, sections: compiledSections, events, rests,
  })
  return { ok: true, diagnostics: [], recipe: linearScoreRecipeV2Schema.parse({ version: 2, language: "tloque-score", source: clean, plan }) }
}
