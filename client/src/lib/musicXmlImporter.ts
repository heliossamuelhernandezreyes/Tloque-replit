import { TLOQUE_SCORE_V2_LIMITS, compileTloqueScore, type LinearScoreRecipe } from "@shared/audio"
import { ORCHESTRAL_SYNTH_MODULE_ID } from "@shared/orchestral-synthesis"
import { extractMusicXmlFromMxl } from "./mxlArchive"
import {
  parseStrictXml, xmlAttribute, xmlChild, xmlChildren, xmlDescendants, xmlLocalName, xmlNumber, xmlText,
  type StrictXmlNode,
} from "./strictXml"

const MAX_XML_BYTES = 12 * 1024 * 1024
const MAX_IMPORT_NOTES = TLOQUE_SCORE_V2_LIMITS.events
const SUPPORTED_DENOMINATORS = [1, 2, 4, 8, 16, 32] as const

type ScoreSynth = "warm" | "pad" | "bell" | "pluck" | "bass"
type ScoreRole = "melody" | "harmony" | "bass" | "pulse" | "texture" | "accent"
type ScoreArticulation = "normal" | "legato" | "staccato" | "tenuto" | "accent" | "spiccato" | "pizzicato" | "tremolo" | "harmonic"
type ScoreTimbre = "natural" | "non-vibrato" | "vibrato" | "expression-vibrato" | "mute" | "harmon-mute" | "straight-mute"

interface Meter { numerator: number; denominator: typeof SUPPORTED_DENOMINATORS[number] }
interface Position { measure: number; offset: number }

interface InstrumentProfile {
  instrument: string
  program: number
  synth: ScoreSynth
  role: ScoreRole
  gain: number
  pan: number
  attack: number
  release: number
  expression: number
  brightness: number
  vibrato: number
}

interface PartDescriptor {
  id: string
  name: string
  instrumentName: string
  program: number | null
  channel: number | null
  unpitched: number | null
  unpitchedByInstrument: ReadonlyMap<string, number>
  profile: InstrumentProfile
}

interface ImportedNote extends Position {
  partId: string
  absoluteStart: number
  duration: number
  note: number
  velocity: number
  articulation: ScoreArticulation
  timbre: ScoreTimbre
  voice: string
  staff: string
}

interface ImportedRest extends Position {
  partId: string
  absoluteStart: number
  duration: number
}

interface ImportedControl extends Position {
  partId: string
  absoluteStart: number
  ramp: number
  expression?: number
  brightness?: number
  vibrato?: number
  pedal?: boolean
}

interface TempoChange extends Position { bpm: number; partId: string }
interface ParsedPart {
  notes: ImportedNote[]
  rests: ImportedRest[]
  controls: ImportedControl[]
  meters: Meter[]
  meterKnown: boolean[]
  tempoChanges: TempoChange[]
  measureCount: number
}

export interface MusicXmlImportWarning {
  code: string
  message: string
  count: number
}

export interface MusicXmlImportReport {
  format: "musicxml" | "mxl"
  sourcePath: string
  sourceParts: number
  outputTracks: number
  measures: number
  notes: number
  controls: number
  sections: number
  mergedParts: number
  warnings: MusicXmlImportWarning[]
}

export interface MusicXmlImportResult {
  source: string
  recipe: LinearScoreRecipe
  title: string
  composer: string
  report: MusicXmlImportReport
}

class WarningCollector {
  private readonly warnings = new Map<string, MusicXmlImportWarning>()

  add(code: string, message: string) {
    const key = `${code}\0${message}`
    const current = this.warnings.get(key)
    if (current) current.count += 1
    else this.warnings.set(key, { code, message, count: 1 })
  }

  values() {
    return [...this.warnings.values()].sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message))
  }
}

const PROFILES: readonly { pattern: RegExp; profile: InstrumentProfile }[] = [
  profile(/\bviolins\b|\bviolins?\s*(?:i{1,3}|[123])\b|\bviolines?(?:\s*(?:i{1,3}|[123]))?\b/i, "strings.violin-section", 40, "pad", "melody", -0.24, 0.27, 0.16, 1.7, 0.74, 0.56, 0.16),
  profile(/\b(?:solo\s+)?violin(?:o)?\b/i, "strings.violin", 40, "pad", "melody", -0.18, 0.24, 0.14, 1.6, 0.76, 0.58, 0.18),
  profile(/\bviolas?\b/i, "strings.viola", 41, "pad", "harmony", 0.18, 0.25, 0.18, 1.8, 0.72, 0.48, 0.13),
  profile(/\b(?:violoncell|cello)s?\b/i, "strings.cello", 42, "bass", "bass", 0.12, 0.27, 0.12, 1.7, 0.74, 0.42, 0.1),
  profile(/\b(?:double\s*bass|contrabass|basses|bajos?)\b/i, "strings.contrabass", 43, "bass", "bass", 0.28, 0.28, 0.1, 1.8, 0.72, 0.34, 0.06),
  profile(/\bharps?\b|\barpa\b/i, "strings.harp", 46, "pluck", "harmony", 0.3, 0.23, 0.008, 2.4, 0.75, 0.62, 0),
  profile(/\bpiccolos?\b/i, "woodwinds.piccolo", 72, "pad", "accent", 0.34, 0.18, 0.05, 1.1, 0.68, 0.78, 0.06),
  profile(/\bflutes?\b|\bflautas?\b/i, "woodwinds.flute", 73, "pad", "melody", 0.26, 0.2, 0.08, 1.3, 0.72, 0.7, 0.08),
  profile(/\benglish\s*horn\b|\bcor\s*anglais\b/i, "woodwinds.english-horn", 69, "pad", "melody", -0.12, 0.21, 0.1, 1.4, 0.74, 0.5, 0.08),
  profile(/\boboes?\b/i, "woodwinds.oboe", 68, "pad", "melody", -0.2, 0.2, 0.08, 1.3, 0.72, 0.62, 0.06),
  profile(/\bbass\s*clarinets?\b/i, "woodwinds.bass-clarinet", 71, "bass", "bass", 0.08, 0.22, 0.07, 1.4, 0.72, 0.4, 0.05),
  profile(/\bclarinets?\b/i, "woodwinds.clarinet", 71, "pad", "melody", 0.02, 0.2, 0.06, 1.25, 0.72, 0.55, 0.06),
  profile(/\bcontra\s*bassoons?\b|\bcontrafagots?\b/i, "woodwinds.contrabassoon", 70, "bass", "bass", 0.16, 0.24, 0.08, 1.5, 0.74, 0.3, 0.03),
  profile(/\bbassoons?\b|\bfagots?\b/i, "woodwinds.bassoon", 70, "bass", "bass", -0.06, 0.22, 0.08, 1.35, 0.72, 0.38, 0.04),
  profile(/\bbass\s*trombones?\b/i, "brass.bass-trombone", 57, "bass", "bass", 0.18, 0.25, 0.06, 1.35, 0.72, 0.42, 0.03),
  profile(/\btrombones?\b/i, "brass.trombone", 57, "pad", "harmony", 0.12, 0.23, 0.06, 1.3, 0.7, 0.52, 0.03),
  profile(/\btrumpets?\b/i, "brass.trumpet", 56, "pad", "accent", -0.08, 0.22, 0.04, 1.15, 0.7, 0.68, 0.03),
  profile(/\b(?:french\s*)?horns?\b|\bcorni?\b/i, "brass.horn", 60, "pad", "harmony", -0.02, 0.23, 0.1, 1.5, 0.72, 0.48, 0.05),
  profile(/\btubas?\b/i, "brass.tuba", 58, "bass", "bass", 0.22, 0.25, 0.08, 1.45, 0.72, 0.36, 0.02),
  profile(/\btimpani\b|\bkettledrums?\b/i, "percussion.timpani", 47, "bass", "accent", 0.08, 0.28, 0.006, 1.6, 0.8, 0.46, 0),
  profile(/\bxylophones?\b/i, "percussion.xylophone", 13, "bell", "accent", 0.24, 0.2, 0.004, 0.8, 0.82, 0.72, 0),
  profile(/\bglockenspiel\b/i, "percussion.glockenspiel", 9, "bell", "accent", 0.3, 0.17, 0.003, 1.2, 0.8, 0.82, 0),
  profile(/\bmarimbas?\b/i, "percussion.marimba", 12, "pluck", "pulse", -0.08, 0.2, 0.004, 1.0, 0.76, 0.58, 0),
  profile(/\b(?:tubular\s*bells?|chimes?)\b/i, "percussion.tubular-bells", 14, "bell", "accent", 0.26, 0.2, 0.004, 2.8, 0.8, 0.72, 0),
  profile(/\b(?:percussion|drums?|cymbals?|triangle|snare|tambourine)\b/i, "percussion.orchestral-kit", 0, "pluck", "accent", 0.08, 0.25, 0.003, 1.2, 0.82, 0.62, 0),
  profile(/\bharpsichords?\b|\bclavecins?\b|\bclavicembal[oi]\b/i, "keys.harpsichord", 6, "pluck", "harmony", -0.06, 0.24, 0.004, 1.0, 0.76, 0.68, 0),
  profile(/\bcelestas?\b/i, "keys.celesta", 8, "bell", "texture", 0.14, 0.19, 0.006, 2.0, 0.7, 0.72, 0),
  profile(/\b(?:pipe\s*)?organs?\b|\borgano\b/i, "keys.pipe-organ", 19, "pad", "harmony", 0, 0.25, 0.05, 2.4, 0.76, 0.5, 0),
  profile(/\bpianos?\b|\bgrand\b/i, "piano.grand", 0, "warm", "harmony", 0, 0.28, 0.01, 2.0, 0.78, 0.56, 0),
]

function profile(pattern: RegExp, instrument: string, program: number, synth: ScoreSynth, role: ScoreRole, pan: number, gain: number, attack: number, release: number, expression: number, brightness: number, vibrato: number) {
  return { pattern, profile: { instrument, program, synth, role, pan, gain, attack, release, expression, brightness, vibrato } }
}

const GM_PROFILE_BY_PROGRAM: Readonly<Record<number, string>> = {
  0: "piano.grand", 6: "keys.harpsichord", 8: "keys.celesta", 9: "percussion.glockenspiel", 12: "percussion.marimba", 13: "percussion.xylophone", 14: "percussion.tubular-bells", 19: "keys.pipe-organ",
  40: "strings.violin", 41: "strings.viola", 42: "strings.cello", 43: "strings.contrabass", 46: "strings.harp", 47: "percussion.timpani",
  56: "brass.trumpet", 57: "brass.trombone", 58: "brass.tuba", 60: "brass.horn", 68: "woodwinds.oboe", 69: "woodwinds.english-horn", 70: "woodwinds.bassoon", 71: "woodwinds.clarinet", 72: "woodwinds.piccolo", 73: "woodwinds.flute",
}

function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim()
}

function inferProfile(name: string, program: number | null, percussion: boolean, warnings: WarningCollector): InstrumentProfile {
  const normalized = normalizeName(name)
  const named = PROFILES.find(candidate => candidate.pattern.test(normalized))
  if (percussion) {
    if (named?.profile.instrument.startsWith("percussion.")) return named.profile
    return PROFILES.find(candidate => candidate.profile.instrument === "percussion.orchestral-kit")!.profile
  }
  if (named) return named.profile
  const knownInstrument = program === null ? null : GM_PROFILE_BY_PROGRAM[program]
  if (knownInstrument) return PROFILES.find(candidate => candidate.profile.instrument === knownInstrument)?.profile ?? {
    instrument: knownInstrument, program: program!, synth: "pad", role: "harmony", gain: 0.22, pan: 0, attack: 0.08, release: 1.3, expression: 0.72, brightness: 0.5, vibrato: 0.04,
  }
  const safeProgram = Math.max(0, Math.min(127, program ?? 0))
  warnings.add("generic-midi-instrument", `${name || "Parte sin nombre"} usa fallback General MIDI ${safeProgram}; revisa su instrumento semántico antes de publicar`)
  return { instrument: `midi.program-${safeProgram}`, program: safeProgram, synth: safeProgram < 40 ? "warm" : safeProgram < 56 ? "pad" : safeProgram < 72 ? "pad" : "pluck", role: "harmony", gain: 0.21, pan: 0, attack: 0.06, release: 1.2, expression: 0.72, brightness: 0.5, vibrato: 0.02 }
}

function finite(value: number | null, fallback: number) {
  return value !== null && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function groupBy<T, K>(items: readonly T[], keyFor: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const key = keyFor(item)
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return groups
}

function parseCompositeBeats(value: string): number | null {
  const parts = value.split("+").map(part => Number(part.trim()))
  if (!parts.length || parts.some(part => !Number.isInteger(part) || part < 1)) return null
  const total = parts.reduce((sum, part) => sum + part, 0)
  return total >= 1 && total <= 32 ? total : null
}

function meterFromAttributes(attributes: StrictXmlNode, warnings: WarningCollector): Meter | null {
  const times = xmlChildren(attributes, "time")
  const time = times[0]
  if (!time) return null
  if (xmlChild(time, "senza-misura") || xmlAttribute(time, "symbol") === "senza-misura") {
    warnings.add("senza-misura", "Un pasaje senza misura conserva sus duraciones escritas dentro del compás heredado y requiere revisión")
    return null
  }
  if (times.length > 1) warnings.add("staff-meters", "La parte declara compases distintos por pentagrama; se usa la primera indicación y requiere revisión")
  if (xmlChild(time, "interchangeable")) warnings.add("interchangeable-meter", "Una indicación de compás intercambiable usa su fracción principal y requiere revisión")
  const beatsNodes = xmlChildren(time, "beats")
  const beatTypeNodes = xmlChildren(time, "beat-type")
  if (!beatsNodes.length || beatsNodes.length !== beatTypeNodes.length) throw new Error("Indicación de compás incompleta en MusicXML")
  const pairs: Meter[] = beatsNodes.map((beatsNode, index) => {
    const beatsText = xmlText(beatsNode)
    if (beatsText.includes("+")) warnings.add("additive-meter", `El compás aditivo ${beatsText} conserva su duración total, pero no sus agrupaciones internas`)
    const beats = parseCompositeBeats(beatsText)
    const rawDenominator = xmlNumber(beatTypeNodes[index])
    if (!beats || !rawDenominator) throw new Error("Indicación de compás incompleta en MusicXML")
    const denominator = SUPPORTED_DENOMINATORS.find(value => value === rawDenominator)
    if (!denominator) {
      warnings.add("unsupported-meter", `El denominador ${rawDenominator} no cabe en TloqueScore; la importación se detuvo para no alterar el ritmo`)
      throw new Error(`Compás con denominador no admitido: ${rawDenominator}`)
    }
    return { numerator: beats, denominator }
  })
  if (pairs.length === 1) return pairs[0]
  const totalQuarterLength = pairs.reduce((sum, pair) => sum + pair.numerator * (4 / pair.denominator), 0)
  const combined = meterForQuarterLength(totalQuarterLength, pairs[0].denominator)
  if (!combined) throw new Error("El compás compuesto de MusicXML no cabe en una fracción TloqueScore exacta")
  warnings.add("composite-meter", `El compás compuesto conserva ${formatNumber(totalQuarterLength)} negras como ${combined.numerator}/${combined.denominator}, sin sus agrupaciones internas`)
  return combined
}

function meterForQuarterLength(quarterLength: number, preferredDenominator: Meter["denominator"]): Meter | null {
  const denominators = [preferredDenominator, ...SUPPORTED_DENOMINATORS.filter(value => value !== preferredDenominator)]
  for (const denominator of denominators) {
    const numerator = quarterLength * denominator / 4
    if (Number.isInteger(numerator) && numerator >= 1 && numerator <= 32) return { numerator, denominator }
  }
  return null
}

function dynamicValue(name: string): number | null {
  return ({ pppp: 0.14, ppp: 0.2, pp: 0.28, p: 0.38, mp: 0.5, mf: 0.64, f: 0.78, ff: 0.9, fff: 0.97, ffff: 1, sf: 0.86, sfz: 0.9, sffz: 0.94, fp: 0.42, rf: 0.82, rfz: 0.86 } as Record<string, number>)[name] ?? null
}

function dynamicFromDirection(direction: StrictXmlNode): number | null {
  for (const dynamics of xmlDescendants(direction, "dynamics")) {
    for (const child of dynamics.children) {
      const value = dynamicValue(xmlLocalName(child.name).toLowerCase())
      if (value !== null) return value
    }
  }
  const sounds = xmlLocalName(direction.name) === "sound" ? [direction] : xmlDescendants(direction, "sound")
  for (const sound of sounds) {
    const value = Number(xmlAttribute(sound, "dynamics"))
    if (Number.isFinite(value)) return clamp(value / 100, 0.01, 1)
  }
  return null
}

function noteArticulation(note: StrictXmlNode, currentPizzicato: boolean, slurActive: boolean, warnings: WarningCollector): { articulation: ScoreArticulation; timbre: ScoreTimbre; durationScale: number } {
  const names = new Set(xmlDescendants(note, "notations").flatMap(notations => xmlDescendants(notations, "articulations").flatMap(item => item.children.map(child => xmlLocalName(child.name)))))
  const allNames = new Set(xmlDescendants(note, "notations").flatMap(notations => notations.children.map(child => xmlLocalName(child.name))))
  const technicalNames = new Set(xmlDescendants(note, "technical").flatMap(item => item.children.map(child => xmlLocalName(child.name))))
  const tied = xmlChildren(note, "tie").length > 0 || xmlDescendants(note, "tied").length > 0
  const slurred = slurActive || xmlDescendants(note, "slur").length > 0
  const tremolo = xmlDescendants(note, "tremolo").length > 0
  const ornaments = xmlDescendants(note, "ornaments")
  const ornamentNames = new Set(ornaments.flatMap(item => item.children.map(child => xmlLocalName(child.name))))
  let articulation: ScoreArticulation = "normal"
  if (currentPizzicato || technicalNames.has("pluck") || xmlDescendants(note, "pizzicato").length) articulation = "pizzicato"
  else if (technicalNames.has("harmonic")) articulation = "harmonic"
  else if (tremolo || ornamentNames.has("trill-mark") || ornamentNames.has("wavy-line")) articulation = "tremolo"
  else if (names.has("spiccato")) articulation = "spiccato"
  else if (names.has("staccato") || names.has("staccatissimo")) articulation = "staccato"
  else if (names.has("strong-accent") || names.has("accent")) articulation = "accent"
  else if (names.has("tenuto")) articulation = "tenuto"
  else if (tied || slurred) articulation = "legato"
  if ([...ornamentNames].some(name => !["trill-mark", "wavy-line", "tremolo"].includes(name))) warnings.add("ornament-base-note", "Un adorno sin equivalente directo conserva su nota base y queda marcado para revisión")
  if (allNames.has("glissando") || allNames.has("slide")) warnings.add("glissando-base-pitches", "Glissando/slide conserva sus alturas extremas; TloqueScore aún no modela el barrido continuo")
  const fermata = xmlDescendants(note, "fermata").length > 0
  if (fermata) warnings.add("fermata-duration", "La fermata se aproxima extendiendo la duración escrita 50 %")
  let timbre: ScoreTimbre = "natural"
  const mute = xmlDescendants(note, "mute").map(xmlText).join(" ").toLowerCase()
  if (mute.includes("harmon")) timbre = "harmon-mute"
  else if (mute.includes("straight")) timbre = "straight-mute"
  return { articulation, timbre, durationScale: fermata ? 1.5 : 1 }
}

function pitchForNote(note: StrictXmlNode, transpose: number, descriptor: PartDescriptor, warnings: WarningCollector): number | null {
  const pitch = xmlChild(note, "pitch")
  if (pitch) {
    const step = xmlText(xmlChild(pitch, "step")).toUpperCase()
    const octave = xmlNumber(xmlChild(pitch, "octave"))
    const alter = finite(xmlNumber(xmlChild(pitch, "alter")), 0)
    const semitone = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[step]
    if (semitone === undefined || octave === null) return null
    if (!Number.isInteger(alter)) warnings.add("microtone-rounded", "Las alteraciones microtonales se redondean al semitono MIDI más cercano")
    const midi = (octave + 1) * 12 + semitone + Math.round(alter) + transpose
    if (midi < 0 || midi > 127) throw new Error(`${descriptor.name}: nota MIDI ${midi} fuera de 0..127`)
    return midi
  }
  const unpitched = xmlChild(note, "unpitched")
  if (unpitched) {
    const instrumentId = xmlAttribute(xmlChild(note, "instrument"), "id")
    const instrumentPitch = instrumentId ? descriptor.unpitchedByInstrument.get(instrumentId) : undefined
    if (instrumentPitch !== undefined) return instrumentPitch
    if (instrumentId && descriptor.unpitchedByInstrument.size > 0) warnings.add("unknown-percussion-instrument", `${descriptor.name}: el golpe ${instrumentId} no tiene midi-unpitched; se usa la altura de respaldo de la parte`)
    if (descriptor.unpitched !== null) return clamp(descriptor.unpitched, 0, 127)
    const step = xmlText(xmlChild(unpitched, "display-step")).toUpperCase()
    const octave = xmlNumber(xmlChild(unpitched, "display-octave"))
    const semitone = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[step]
    if (semitone !== undefined && octave !== null) return clamp((octave + 1) * 12 + semitone, 0, 127)
    warnings.add("unpitched-fallback", `${descriptor.name}: percusión sin midi-unpitched usa golpe central 60`)
    return 60
  }
  return null
}

function directionPosition(direction: StrictXmlNode, cursor: number, divisions: number): number {
  const soundOffset = xmlDescendants(direction, "sound").map(sound => xmlNumber(xmlChild(sound, "offset"))).find(value => value !== null)
  const directionOffset = xmlNumber(xmlChild(direction, "offset"))
  return Math.max(0, cursor + finite(soundOffset ?? directionOffset, 0) / divisions)
}

function tempoFromNode(node: StrictXmlNode): number | null {
  for (const sound of [node, ...xmlDescendants(node, "sound")]) {
    if (xmlLocalName(sound.name) !== "sound") continue
    const tempo = Number(xmlAttribute(sound, "tempo"))
    if (Number.isFinite(tempo) && tempo > 0) return tempo
  }
  for (const metronome of xmlDescendants(node, "metronome")) {
    const perMinute = xmlNumber(xmlChild(metronome, "per-minute"))
    if (perMinute && perMinute > 0) {
      const beatUnit = xmlText(xmlChild(metronome, "beat-unit")).toLowerCase()
      const quarterUnits = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125 } as Record<string, number>)[beatUnit] ?? 1
      const dots = xmlChildren(metronome, "beat-unit-dot").length
      let dotFactor = 1
      let addition = 0.5
      for (let index = 0; index < dots; index += 1) {
        dotFactor += addition
        addition /= 2
      }
      return perMinute * quarterUnits * dotFactor
    }
  }
  return null
}

function tieTypes(note: StrictXmlNode): Set<string> {
  return new Set([...xmlChildren(note, "tie"), ...xmlDescendants(note, "tied")].map(item => xmlAttribute(item, "type") ?? ""))
}

function parsePart(descriptor: PartDescriptor, part: StrictXmlNode, warnings: WarningCollector): ParsedPart {
  const notes: ImportedNote[] = []
  const rests: ImportedRest[] = []
  const controls: ImportedControl[] = []
  const meters: Meter[] = []
  const meterKnown: boolean[] = []
  const tempoChanges: TempoChange[] = []
  const openTies = new Map<string, ImportedNote>()
  const openSlurs = new Map<string, Set<string>>()
  const openWedges = new Map<string, { type: "crescendo" | "diminuendo"; measure: number; offset: number; absoluteStart: number; expression: number }>()
  let divisions = 1
  let meter: Meter = { numerator: 4, denominator: 4 }
  let transpose = 0
  let expression = descriptor.profile.expression
  let pizzicato = false
  let measureStart = 0
  let hasExplicitMeter = false
  const measures = xmlChildren(part, "measure")

  const closeWedges = (absoluteStart: number, target: number | null = null, onlyNumber?: string) => {
    for (const [number, wedge] of openWedges) {
      if (onlyNumber !== undefined && number !== onlyNumber) continue
      const resolved = clamp(target ?? wedge.expression + (wedge.type === "crescendo" ? 0.18 : -0.18), 0.01, 1)
      const writtenRamp = Math.max(0, absoluteStart - wedge.absoluteStart)
      if (writtenRamp > 64) warnings.add("hairpin-ramp-clamped", `${descriptor.name}: un regulador de ${formatNumber(writtenRamp)} negras se limita a 64 por el contrato TloqueScore`)
      controls.push({ partId: descriptor.id, measure: wedge.measure, offset: wedge.offset, absoluteStart: wedge.absoluteStart, ramp: clamp(writtenRamp, 0, 64), expression: resolved })
      expression = resolved
      openWedges.delete(number)
    }
  }

  for (let measureIndex = 0; measureIndex < measures.length; measureIndex += 1) {
    const measureNode = measures[measureIndex]
    let cursor = 0
    let previousOnset = 0
    let measureExtent = 0
    let measureMeter = meter
    let measureMeterKnown = hasExplicitMeter
    for (const item of measureNode.children) {
      const kind = xmlLocalName(item.name)
      if (kind === "attributes") {
        if (xmlDescendants(item, "measure-repeat").length) throw new Error(`${descriptor.name}: expande las repeticiones abreviadas de compás antes de importar para no omitir notas`)
        if (xmlDescendants(item, "multiple-rest").length) warnings.add("multiple-rest", `${descriptor.name}: un silencio multicompas conserva los compases escritos en el archivo y requiere revisar su duración`)
        const nextDivisions = xmlNumber(xmlChild(item, "divisions"))
        if (nextDivisions && nextDivisions > 0) divisions = nextDivisions
        const nextMeter = meterFromAttributes(item, warnings)
        if (nextMeter) {
          meter = nextMeter
          hasExplicitMeter = true
          if (cursor <= 1e-6) {
            measureMeter = meter
            measureMeterKnown = true
          }
          else warnings.add("mid-measure-meter", `${descriptor.name}: un cambio de compás interno del compás ${measureIndex + 1} se aplica al siguiente límite de compás`)
        }
        const transposeNode = xmlChild(item, "transpose")
        if (transposeNode) transpose = finite(xmlNumber(xmlChild(transposeNode, "chromatic")), 0) + finite(xmlNumber(xmlChild(transposeNode, "octave-change")), 0) * 12
        continue
      }
      if (kind === "backup" || kind === "forward") {
        const duration = finite(xmlNumber(xmlChild(item, "duration")), 0) / divisions
        cursor = Math.max(0, cursor + (kind === "backup" ? -duration : duration))
        measureExtent = Math.max(measureExtent, cursor)
        continue
      }
      if (kind === "barline") {
        if (xmlDescendants(item, "repeat").length || xmlDescendants(item, "ending").length) warnings.add("written-repeats", "Las repeticiones y casillas se importan en orden escrito, sin desplegar saltos de navegación")
        continue
      }
      if (kind === "direction" || kind === "sound") {
        if (kind === "direction" && xmlChild(item, "staff")) warnings.add("staff-direction", `${descriptor.name}: una indicación dirigida a un pentagrama se aplica a toda la parte importada`)
        const rawOffset = kind === "direction" ? directionPosition(item, cursor, divisions) : cursor
        const barQuarterLength = meter.numerator * (4 / meter.denominator)
        const atOrBeyondBarline = rawOffset >= barQuarterLength - 1e-6
        const directionMeasure = atOrBeyondBarline && measureIndex + 1 < measures.length ? measureIndex + 1 : measureIndex
        const offset = atOrBeyondBarline
          ? directionMeasure === measureIndex ? Math.max(0, barQuarterLength - 0.000001) : 0
          : rawOffset
        const absoluteStart = directionMeasure === measureIndex ? measureStart + offset : measureStart + barQuarterLength
        if (rawOffset > barQuarterLength + 1e-6) warnings.add("direction-outside-measure", `${descriptor.name}: una indicación fuera del compás ${measureIndex + 1} se colocó en el siguiente límite de compás`)
        const tempo = tempoFromNode(item)
        if (tempo) tempoChanges.push({ partId: descriptor.id, measure: directionMeasure, offset, bpm: tempo })
        const dynamic = dynamicFromDirection(item)
        if (dynamic !== null) {
          if (openWedges.size) closeWedges(absoluteStart, dynamic)
          else controls.push({ partId: descriptor.id, measure: directionMeasure, offset, absoluteStart, ramp: 0, expression: dynamic })
          expression = dynamic
        }
        const words = xmlDescendants(item, "words").map(xmlText).join(" ").toLowerCase()
        if (/\bpizz(?:\.|icato)?\b/.test(words)) pizzicato = true
        if (/\barco\b/.test(words)) pizzicato = false
        for (const sound of kind === "sound" ? [item] : xmlDescendants(item, "sound")) {
          if (["dacapo", "dalsegno", "tocoda", "fine", "segno", "coda"].some(attribute => xmlAttribute(sound, attribute))) {
            warnings.add("navigation-mark", "Las marcas Da Capo, Dal Segno, Coda o Fine no se despliegan; se conserva el orden escrito")
          }
          const pizzicatoValue = xmlAttribute(sound, "pizzicato")
          if (pizzicatoValue === "yes") pizzicato = true
          if (pizzicatoValue === "no") pizzicato = false
          const pedalValue = xmlAttribute(sound, "damper-pedal") ?? xmlAttribute(sound, "pedal")
          if (pedalValue === "yes" || pedalValue === "no") controls.push({ partId: descriptor.id, measure: directionMeasure, offset, absoluteStart, ramp: 0, pedal: pedalValue === "yes" })
        }
        for (const pedal of xmlDescendants(item, "pedal")) {
          const type = xmlAttribute(pedal, "type")
          if (["start", "resume", "change"].includes(type ?? "")) controls.push({ partId: descriptor.id, measure: directionMeasure, offset, absoluteStart, ramp: 0, pedal: true })
          if (["stop", "discontinue"].includes(type ?? "")) controls.push({ partId: descriptor.id, measure: directionMeasure, offset, absoluteStart, ramp: 0, pedal: false })
        }
        for (const wedge of xmlDescendants(item, "wedge")) {
          const type = xmlAttribute(wedge, "type")
          const number = xmlAttribute(wedge, "number") ?? "1"
          if (type === "crescendo" || type === "diminuendo") openWedges.set(number, { type, measure: directionMeasure, offset, absoluteStart, expression })
          else if (type === "stop") closeWedges(absoluteStart, null, number)
        }
        continue
      }
      if (kind !== "note") continue
      const duration = finite(xmlNumber(xmlChild(item, "duration")), 0) / divisions
      const chord = Boolean(xmlChild(item, "chord"))
      const grace = Boolean(xmlChild(item, "grace"))
      const onset = chord ? previousOnset : cursor
      if (!chord) previousOnset = onset
      if (!chord && !grace) cursor += duration
      if (!grace) measureExtent = Math.max(measureExtent, cursor, onset + duration)
      if (xmlChild(item, "cue")) {
        warnings.add("cue-note-skipped", "Las cue notes editoriales no se reproducen")
        continue
      }
      const effectiveDuration = grace ? Math.max(0.0625, Math.min(0.25, finite(Number(xmlAttribute(xmlChild(item, "grace"), "steal-time-following")), 12.5) / 100)) : duration
      if (grace) warnings.add("grace-note", "Las apoyaturas se conservan como ataques cortos sin desplazar el pulso principal")
      if (effectiveDuration <= 0) continue
      if (xmlChild(item, "rest")) {
        rests.push({ partId: descriptor.id, measure: measureIndex, offset: onset, absoluteStart: measureStart + onset, duration: effectiveDuration })
        continue
      }
      const midi = pitchForNote(item, transpose, descriptor, warnings)
      if (midi === null) {
        warnings.add("note-without-pitch", `${descriptor.name}: una nota sin altura reproducible fue omitida`)
        continue
      }
      const voice = xmlText(xmlChild(item, "voice")) || "1"
      const staff = xmlText(xmlChild(item, "staff")) || "1"
      const slurs = xmlDescendants(item, "slur")
      const slurPrefix = `${voice}:${staff}:`
      const slurNumbers = openSlurs.get(slurPrefix) ?? new Set<string>()
      const slurActive = slurs.length > 0 || slurNumbers.size > 0
      const rendering = noteArticulation(item, pizzicato, slurActive, warnings)
      for (const slur of slurs) {
        const number = xmlAttribute(slur, "number") ?? "1"
        const type = xmlAttribute(slur, "type")
        if (type === "start" || type === "continue") slurNumbers.add(number)
        if (type === "stop") slurNumbers.delete(number)
      }
      if (slurNumbers.size) openSlurs.set(slurPrefix, slurNumbers)
      else openSlurs.delete(slurPrefix)
      const rawSoundDynamics = xmlAttribute(item, "dynamics")
      const soundDynamics = rawSoundDynamics === null ? Number.NaN : Number(rawSoundDynamics)
      const velocityNode = xmlNumber(xmlChild(item, "velocity"))
      const velocity = clamp(Number.isFinite(soundDynamics) ? soundDynamics / 100 : velocityNode !== null ? velocityNode / 127 : 0.68, 0.01, 1)
      const ties = tieTypes(item)
      const tieKey = `${voice}:${staff}:${midi}`
      const open = openTies.get(tieKey)
      if (ties.has("stop") && open) {
        open.duration = Math.max(open.duration, measureStart + onset + effectiveDuration * rendering.durationScale - open.absoluteStart)
        if (ties.has("start")) openTies.set(tieKey, open)
        else openTies.delete(tieKey)
        continue
      }
      if (ties.has("stop") && !open) warnings.add("orphan-tie", `${descriptor.name}: una ligadura de continuación no encontró su ataque inicial`)
      const imported: ImportedNote = { partId: descriptor.id, measure: measureIndex, offset: onset, absoluteStart: measureStart + onset, duration: effectiveDuration * rendering.durationScale, note: midi, velocity, articulation: rendering.articulation, timbre: rendering.timbre, voice, staff }
      notes.push(imported)
      if (ties.has("start")) openTies.set(tieKey, imported)
      if (notes.length > MAX_IMPORT_NOTES) throw new Error(`La partitura supera ${MAX_IMPORT_NOTES} notas antes de agrupar acordes`)
    }
    const nominalQuarterLength = measureMeter.numerator * (4 / measureMeter.denominator)
    let effectiveMeter = measureMeter
    let inferredImplicitMeter = false
    if (xmlAttribute(measureNode, "implicit") === "yes" && measureExtent > 1e-6 && Math.abs(measureExtent - nominalQuarterLength) > 1e-6) {
      const inferred = meterForQuarterLength(measureExtent, measureMeter.denominator)
      if (!inferred) throw new Error(`${descriptor.name}: el compás implícito ${measureIndex + 1} dura ${formatNumber(measureExtent)} negras y no cabe en un compás TloqueScore exacto`)
      effectiveMeter = inferred
      inferredImplicitMeter = true
      warnings.add("implicit-measure", `${descriptor.name}: el compás implícito ${measureIndex + 1} se conserva como ${inferred.numerator}/${inferred.denominator}`)
    }
    meters.push(effectiveMeter)
    meterKnown.push(measureMeterKnown || inferredImplicitMeter)
    measureStart += effectiveMeter.numerator * (4 / effectiveMeter.denominator)
  }
  if (openTies.size) warnings.add("open-tie", `${descriptor.name}: ${openTies.size} ligaduras quedaron abiertas al final de la parte`)
  const openSlurCount = [...openSlurs.values()].reduce((sum, values) => sum + values.size, 0)
  if (openSlurCount) warnings.add("open-slur", `${descriptor.name}: ${openSlurCount} ligaduras de frase quedaron abiertas al final de la parte`)
  if (openWedges.size) closeWedges(measureStart)
  return { notes, rests, controls, meters, meterKnown, tempoChanges, measureCount: measures.length }
}

function scorePartwise(root: StrictXmlNode): StrictXmlNode {
  const rootName = xmlLocalName(root.name)
  if (rootName === "score-partwise") return root
  if (rootName !== "score-timewise") throw new Error("El archivo debe contener <score-partwise> o <score-timewise>")
  const partList = xmlChild(root, "part-list")
  if (!partList) throw new Error("MusicXML timewise no contiene <part-list>")
  const partIds = xmlChildren(partList, "score-part").map(part => xmlAttribute(part, "id")).filter((id): id is string => Boolean(id))
  if (new Set(partIds).size !== partIds.length) throw new Error("MusicXML repite un identificador de parte")
  const parts: StrictXmlNode[] = partIds.map(id => ({ name: "part", attributes: { id }, text: "", children: [] }))
  const byId = new Map(parts.map(part => [part.attributes.id, part]))
  for (const measure of xmlChildren(root, "measure")) {
    for (const timewisePart of xmlChildren(measure, "part")) {
      const id = xmlAttribute(timewisePart, "id")
      const target = id ? byId.get(id) : null
      if (!target) throw new Error(`MusicXML timewise contiene la parte ${id || "sin id"}, pero no la declara en <part-list>`)
      target.children.push({ name: "measure", attributes: { ...measure.attributes }, text: "", children: timewisePart.children })
    }
  }
  return { name: "score-partwise", attributes: { ...root.attributes }, text: "", children: [partList, ...root.children.filter(child => !["part-list", "measure"].includes(xmlLocalName(child.name))), ...parts] }
}

function partDescriptors(root: StrictXmlNode, warnings: WarningCollector): PartDescriptor[] {
  const partList = xmlChild(root, "part-list")
  if (!partList) throw new Error("MusicXML no contiene <part-list>")
  const usedIds = new Set<string>()
  return xmlChildren(partList, "score-part").map(part => {
    const id = xmlAttribute(part, "id")
    if (!id) throw new Error("Una parte de MusicXML no tiene atributo id")
    if (usedIds.has(id)) throw new Error(`MusicXML repite la parte ${id}`)
    usedIds.add(id)
    const name = (xmlText(xmlChild(part, "part-name")) || `Parte ${usedIds.size}`).slice(0, 160)
    const scoreInstruments = xmlChildren(part, "score-instrument")
    const midiInstruments = xmlChildren(part, "midi-instrument")
    if (scoreInstruments.length > 1 || midiInstruments.length > 1) warnings.add("multi-instrument-part", `${name}: varios instrumentos comparten una parte; se usa el primer perfil y se conservan todas sus notas`)
    const scoreInstrument = scoreInstruments[0]
    const instrumentName = xmlText(xmlChild(scoreInstrument, "instrument-name")).slice(0, 160)
    const midiInstrument = midiInstruments[0]
    const rawProgram = xmlNumber(xmlChild(midiInstrument, "midi-program"))
    const rawChannel = xmlNumber(xmlChild(midiInstrument, "midi-channel"))
    const rawUnpitched = xmlNumber(xmlChild(midiInstrument, "midi-unpitched"))
    const program = rawProgram === null ? null : clamp(Math.round(rawProgram) - 1, 0, 127)
    const channel = rawChannel === null ? null : clamp(Math.round(rawChannel), 1, 16)
    const unpitched = rawUnpitched === null ? null : clamp(Math.round(rawUnpitched) - 1, 0, 127)
    const unpitchedByInstrument = new Map<string, number>()
    for (const candidate of midiInstruments) {
      const instrumentId = xmlAttribute(candidate, "id")
      const value = xmlNumber(xmlChild(candidate, "midi-unpitched"))
      if (instrumentId && value !== null) unpitchedByInstrument.set(instrumentId, clamp(Math.round(value) - 1, 0, 127))
    }
    return { id, name, instrumentName, program, channel, unpitched, unpitchedByInstrument, profile: inferProfile(`${name} ${instrumentName}`, program, channel === 10, warnings) }
  })
}

function titleAndComposer(root: StrictXmlNode, fileName: string) {
  const title = xmlText(xmlChild(root, "movement-title")) || xmlText(xmlChild(xmlChild(root, "work"), "work-title")) || fileName.replace(/\.(?:musicxml|xml|mxl)$/i, "") || "Partitura importada"
  const identification = xmlChild(root, "identification")
  const creators = identification ? xmlChildren(identification, "creator") : []
  const composer = xmlText(creators.find(creator => (xmlAttribute(creator, "type") ?? "").toLowerCase() === "composer") ?? creators[0])
  return { title: title.slice(0, 160), composer: composer.slice(0, 160) }
}

function canonicalTimeline(parsed: readonly ParsedPart[], measureCount: number, warnings: WarningCollector): { meters: Meter[]; tempos: number[] } {
  const tempoAt = new Map<number, number>()
  for (const part of parsed) {
    for (const change of part.tempoChanges) {
      const targetMeasure = change.offset > 1e-6 ? change.measure + 1 : change.measure
      if (targetMeasure >= measureCount) continue
      if (change.offset > 1e-6) warnings.add("mid-measure-tempo", `Un cambio de tempo interno del compás ${change.measure + 1} se cuantizó al siguiente límite de compás`)
      const bpm = Math.round(clamp(change.bpm, 20, 300))
      if (Math.abs(bpm - change.bpm) > 1e-6) warnings.add("tempo-clamped", `Tempo ${change.bpm} BPM ajustado al intervalo 20..300`)
      const current = tempoAt.get(targetMeasure)
      if (current === undefined) tempoAt.set(targetMeasure, bpm)
      else if (current !== bpm) warnings.add("conflicting-tempo", `Partes distintas declaran tempos incompatibles en el compás ${targetMeasure + 1}; se conserva la primera declaración`)
    }
  }
  if (!parsed.some(part => part.meterKnown.some(Boolean))) {
    warnings.add("default-meter", "No se encontró compás inicial; se usa 4/4")
  }
  if (!tempoAt.has(0)) {
    tempoAt.set(0, 120)
    warnings.add("default-tempo", "No se encontró tempo inicial; se usa 120 BPM")
  }
  const meters: Meter[] = []
  const tempos: number[] = []
  let tempo = tempoAt.get(0)!
  for (let measure = 0; measure < measureCount; measure += 1) {
    let meter: Meter | null = null
    const knownParts = parsed.filter(part => part.meterKnown[measure])
    const meterParts = knownParts.length ? knownParts : parsed
    for (const part of meterParts) {
      const candidate = part.meters[measure]
      if (!candidate) continue
      if (!meter) meter = candidate
      else if (meter.numerator !== candidate.numerator || meter.denominator !== candidate.denominator) warnings.add("conflicting-meter", `Partes distintas declaran duraciones de compás incompatibles en el compás ${measure + 1}; se conserva la primera parte`)
    }
    tempo = tempoAt.get(measure) ?? tempo
    meters.push(meter ?? meters.at(-1) ?? { numerator: 4, denominator: 4 })
    tempos.push(tempo)
  }
  return { meters, tempos }
}

interface OutputTrack { id: string; profile: InstrumentProfile; partIds: string[]; label: string }

function safeId(value: string, fallback: string, used: Set<string>) {
  const base = normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 26) || fallback
  const rooted = /^[a-z]/.test(base) ? base : `p-${base}`
  let candidate = rooted.slice(0, 32)
  let suffix = 2
  while (used.has(candidate)) {
    const ending = `-${suffix++}`
    candidate = `${rooted.slice(0, 32 - ending.length)}${ending}`
  }
  used.add(candidate)
  return candidate
}

function outputTracks(descriptors: readonly PartDescriptor[], parsedByPart: ReadonlyMap<string, ParsedPart>, warnings: WarningCollector): { tracks: OutputTrack[]; partToTrack: Map<string, string> } {
  const active = descriptors.filter(descriptor => (parsedByPart.get(descriptor.id)?.notes.length ?? 0) > 0)
  const groups = active.length <= TLOQUE_SCORE_V2_LIMITS.tracks
    ? active.map(descriptor => [descriptor])
    : [...groupBy(active, descriptor => descriptor.profile.instrument).values()]
  if (active.length > TLOQUE_SCORE_V2_LIMITS.tracks) warnings.add("equivalent-parts-merged", `${active.length} partes se agruparon por instrumento equivalente para respetar ${TLOQUE_SCORE_V2_LIMITS.tracks} canales`)
  if (groups.length > TLOQUE_SCORE_V2_LIMITS.tracks) throw new Error(`La partitura necesita ${groups.length} instrumentos no equivalentes y Tloque admite ${TLOQUE_SCORE_V2_LIMITS.tracks}; divídela por movimientos o secciones orquestales`)
  const used = new Set<string>()
  const partToTrack = new Map<string, string>()
  const tracks = groups.map((group, index) => {
    const first = group[0]
    const id = safeId(group.length > 1 ? first.profile.instrument : first.name, `part-${index + 1}`, used)
    group.forEach(descriptor => partToTrack.set(descriptor.id, id))
    return { id, profile: first.profile, partIds: group.map(descriptor => descriptor.id), label: group.map(descriptor => descriptor.name).join(" + ") }
  })
  return { tracks, partToTrack }
}

interface Section { id: string; start: number; end: number; meter: Meter; bpm: number }
function sectionsFor(meters: readonly Meter[], tempos: readonly number[]): Section[] {
  const sections: Section[] = []
  for (let measure = 0; measure < meters.length; measure += 1) {
    const previous = sections.at(-1)
    const changed = !previous || previous.bpm !== tempos[measure] || previous.meter.numerator !== meters[measure].numerator || previous.meter.denominator !== meters[measure].denominator || measure - previous.start >= TLOQUE_SCORE_V2_LIMITS.sectionBars
    if (changed) sections.push({ id: `mx-${String(measure + 1).padStart(4, "0")}`, start: measure, end: measure + 1, meter: meters[measure], bpm: tempos[measure] })
    else previous.end = measure + 1
  }
  return sections
}

function formatNumber(value: number) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
}

function quote(value: string) {
  return `"${value.replace(/["\r\n]+/g, " ").replace(/\s+/g, " ").trim()}"`
}

function midiName(midi: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function seedFor(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) & 0x7fffffff
}

function importFromXml(xml: string, fileName: string, format: "musicxml" | "mxl", sourcePath: string): MusicXmlImportResult {
  const warnings = new WarningCollector()
  const root = scorePartwise(parseStrictXml(xml, { maxCharacters: MAX_XML_BYTES, maxNodes: 500_000, maxDepth: 128 }))
  if (xmlDescendants(root, "lyric").length) warnings.add("lyrics-omitted", "El texto cantado se omite; Tloque conserva únicamente la música instrumental")
  const descriptors = partDescriptors(root, warnings)
  if (!descriptors.length) throw new Error("MusicXML no declara ninguna parte instrumental")
  const partNodeList = xmlChildren(root, "part")
  const partNodeIds = partNodeList.map(part => xmlAttribute(part, "id"))
  if (partNodeIds.some(id => !id)) throw new Error("Una parte musical no tiene atributo id")
  if (new Set(partNodeIds).size !== partNodeIds.length) throw new Error("MusicXML repite el contenido de una parte")
  const descriptorIds = new Set(descriptors.map(descriptor => descriptor.id))
  const undeclaredPart = partNodeIds.find((id): id is string => Boolean(id && !descriptorIds.has(id)))
  if (undeclaredPart) throw new Error(`MusicXML contiene la parte ${undeclaredPart}, pero no la declara en <part-list>`)
  const partNodes = new Map(partNodeList.map(part => [xmlAttribute(part, "id")!, part]))
  const parsed = descriptors.map(descriptor => {
    const node = partNodes.get(descriptor.id)
    if (!node) {
      warnings.add("missing-part", `La parte ${descriptor.name} está declarada pero no contiene compases`)
      return { notes: [], rests: [], controls: [], meters: [], meterKnown: [], tempoChanges: [], measureCount: 0 } satisfies ParsedPart
    }
    return parsePart(descriptor, node, warnings)
  })
  const parsedByPart = new Map(descriptors.map((descriptor, index) => [descriptor.id, parsed[index]]))
  const measureCount = Math.max(...parsed.map(part => part.measureCount))
  if (measureCount < 1) throw new Error("MusicXML no contiene compases reproducibles")
  if (measureCount > TLOQUE_SCORE_V2_LIMITS.totalBars) throw new Error(`La obra contiene ${measureCount} compases; el límite es ${TLOQUE_SCORE_V2_LIMITS.totalBars}`)
  if (parsed.some(part => part.measureCount && part.measureCount !== measureCount)) warnings.add("unequal-part-length", "Las partes no tienen el mismo número de compases; las partes más cortas terminan en silencio")
  const { meters, tempos } = canonicalTimeline(parsed, measureCount, warnings)
  const sections = sectionsFor(meters, tempos)
  if (sections.length > TLOQUE_SCORE_V2_LIMITS.sections) throw new Error(`La partitura genera ${sections.length} secciones de tempo/compás; el límite es ${TLOQUE_SCORE_V2_LIMITS.sections}`)
  const sectionByMeasure = new Array<Section>(measureCount)
  sections.forEach(section => { for (let measure = section.start; measure < section.end; measure += 1) sectionByMeasure[measure] = section })
  const measureStarts: number[] = []
  const measureSecondStarts: number[] = []
  let quarterCursor = 0
  let secondCursor = 0
  for (let measure = 0; measure < measureCount; measure += 1) {
    measureStarts.push(quarterCursor)
    measureSecondStarts.push(secondCursor)
    const measureQuarters = meters[measure].numerator * (4 / meters[measure].denominator)
    quarterCursor += measureQuarters
    secondCursor += measureQuarters * 60 / tempos[measure]
  }
  const { tracks, partToTrack } = outputTracks(descriptors, parsedByPart, warnings)
  if (!tracks.length) throw new Error("MusicXML no contiene notas reproducibles")
  const metadata = titleAndComposer(root, fileName)

  const allNotes = parsed.flatMap(part => part.notes).filter(note => note.measure < measureCount)
  const allControls = parsed.flatMap(part => part.controls).filter(control => control.measure < measureCount).map(control => {
    const measureQuarterLength = meters[control.measure].numerator * (4 / meters[control.measure].denominator)
    if (control.offset < measureQuarterLength - 1e-6) return control
    warnings.add("barline-control", "Una indicación escrita sobre una barra de compás se coloca al inicio del compás siguiente")
    if (control.measure + 1 < measureCount) {
      return { ...control, measure: control.measure + 1, offset: 0, absoluteStart: measureStarts[control.measure + 1] }
    }
    const offset = Math.max(0, measureQuarterLength - 0.000001)
    return { ...control, offset, absoluteStart: measureStarts[control.measure] + offset }
  })
  const allRests = parsed.flatMap(part => part.rests).filter(rest => rest.measure < measureCount)
  if (allNotes.length > MAX_IMPORT_NOTES) throw new Error(`La partitura supera ${MAX_IMPORT_NOTES} notas`)
  for (const item of [...allNotes, ...allRests]) {
    if (item.duration > 256) throw new Error(`La partitura contiene una duración de ${formatNumber(item.duration)} negras; el máximo por evento es 256`)
    if (item.duration < 0.03125) warnings.add("short-duration-raised", "Duraciones menores que 1/32 de negra se elevan a ese mínimo reproducible")
  }
  const playbackDuration = (item: Position & { duration: number }) => {
    const absoluteStart = measureStarts[item.measure] + item.offset
    const absoluteEnd = absoluteStart + item.duration
    let low = 0
    let high = measureStarts.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (measureStarts[middle] <= absoluteEnd + 1e-9) low = middle + 1
      else high = middle
    }
    const endMeasure = Math.max(item.measure, Math.min(measureCount - 1, low - 1))
    const startSeconds = measureSecondStarts[item.measure] + item.offset * 60 / tempos[item.measure]
    const endSeconds = measureSecondStarts[endMeasure] + (absoluteEnd - measureStarts[endMeasure]) * 60 / tempos[endMeasure]
    const equivalentQuarters = (endSeconds - startSeconds) * tempos[item.measure] / 60
    if (Math.abs(equivalentQuarters - item.duration) > 1e-6) {
      warnings.add("duration-across-tempo", "Una duración atraviesa un cambio de tempo; se normaliza para conservar su final en tiempo de audio")
    }
    if (equivalentQuarters > 256 + 1e-6) throw new Error(`Un cambio de tempo convierte una duración sostenida en ${formatNumber(equivalentQuarters)} negras equivalentes; el máximo es 256`)
    return clamp(equivalentQuarters, 0.03125, 256)
  }

  const groupedNotes = new Map<string, { trackId: string; measure: number; offset: number; duration: number; velocity: number; articulation: ScoreArticulation; timbre: ScoreTimbre; notes: number[] }>()
  for (const note of allNotes) {
    const trackId = partToTrack.get(note.partId)
    if (!trackId) continue
    const duration = playbackDuration(note)
    const key = [trackId, note.measure, formatNumber(note.offset), formatNumber(duration), formatNumber(note.velocity), note.articulation, note.timbre].join("|")
    const group = groupedNotes.get(key)
    if (group) group.notes.push(note.note)
    else groupedNotes.set(key, { trackId, measure: note.measure, offset: note.offset, duration, velocity: note.velocity, articulation: note.articulation, timbre: note.timbre, notes: [note.note] })
  }
  const outputNotes = [...groupedNotes.values()].flatMap(group => {
    const unique = [...new Set(group.notes)].sort((left, right) => left - right)
    const chunks: typeof group[] = []
    for (let index = 0; index < unique.length; index += 12) chunks.push({ ...group, notes: unique.slice(index, index + 12) })
    return chunks
  })
  if (outputNotes.length > TLOQUE_SCORE_V2_LIMITS.events) throw new Error(`La partitura produce ${outputNotes.length} ataques; el límite es ${TLOQUE_SCORE_V2_LIMITS.events}`)

  const controlsByKey = new Map<string, ImportedControl & { trackId: string }>()
  for (const control of allControls) {
    const trackId = partToTrack.get(control.partId)
    if (!trackId) continue
    const key = `${trackId}|${control.measure}|${formatNumber(control.offset)}|${formatNumber(control.ramp)}`
    controlsByKey.set(key, { ...(controlsByKey.get(key) ?? {}), ...control, trackId })
  }

  const mergedNoteIntervals = new Map<string, { start: number; end: number }[]>()
  const writtenNotesByTrack = groupBy(allNotes.flatMap(note => {
    const trackId = partToTrack.get(note.partId)
    return trackId ? [{ trackId, note }] : []
  }), item => item.trackId)
  for (const [trackId, trackNotes] of writtenNotesByTrack) {
    const intervals = trackNotes
      .map(({ note }) => ({ start: measureStarts[note.measure] + note.offset, end: measureStarts[note.measure] + note.offset + note.duration }))
      .sort((left, right) => left.start - right.start || left.end - right.end)
    const merged: { start: number; end: number }[] = []
    for (const interval of intervals) {
      const previous = merged.at(-1)
      if (previous && interval.start < previous.end - 1e-6) previous.end = Math.max(previous.end, interval.end)
      else merged.push({ ...interval })
    }
    mergedNoteIntervals.set(trackId, merged)
  }
  const visibleRests = allRests.filter(rest => {
    const trackId = partToTrack.get(rest.partId)
    if (!trackId) return false
    const start = measureStarts[rest.measure] + rest.offset
    const end = start + rest.duration
    const intervals = mergedNoteIntervals.get(trackId) ?? []
    let low = 0
    let high = intervals.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (intervals[middle].start < end - 1e-6) low = middle + 1
      else high = middle
    }
    return low === 0 || intervals[low - 1].end <= start + 1e-6
  }).map(rest => ({ ...rest, duration: playbackDuration(rest) }))

  const lines = [
    "TLOQUE_SCORE 2",
    `title ${quote(metadata.title)}`,
    `tempo ${tempos[0]}`,
    `meter ${meters[0].numerator}/${meters[0].denominator}`,
    "loop false",
    `seed ${seedFor(xml)}`,
    "humanize 0",
    "quality master",
    `module ${ORCHESTRAL_SYNTH_MODULE_ID}`,
    "",
  ]
  for (const track of tracks) {
    const value = track.profile
    lines.push(`track ${track.id} synth=${value.synth} instrument=${value.instrument} program=${value.program} role=${value.role} gain=${formatNumber(value.gain)} pan=${formatNumber(value.pan)} attack=${formatNumber(value.attack)} release=${formatNumber(value.release)} expression=${formatNumber(value.expression)} brightness=${formatNumber(value.brightness)} vibrato=${formatNumber(value.vibrato)} timbre=natural`)
  }

  const notesBySectionTrack = groupBy(outputNotes, note => `${sectionByMeasure[note.measure].id}|${note.trackId}`)
  const controlsBySectionTrack = groupBy([...controlsByKey.values()], control => `${sectionByMeasure[control.measure].id}|${control.trackId}`)
  const restsBySectionTrack = groupBy(visibleRests, rest => `${sectionByMeasure[rest.measure].id}|${partToTrack.get(rest.partId)}`)
  for (const section of sections) {
    lines.push("", `section ${section.id} form=custom bars=${section.end - section.start} repeat=1 fade=0 tempo=${section.bpm} meter=${section.meter.numerator}/${section.meter.denominator} rubato=0`)
    const beatUnit = 4 / section.meter.denominator
    for (const track of tracks) {
      const key = `${section.id}|${track.id}`
      const sectionNotes = notesBySectionTrack.get(key) ?? []
      const sectionControls = controlsBySectionTrack.get(key) ?? []
      const sectionRests = restsBySectionTrack.get(key) ?? []
      if (!sectionNotes.length && !sectionControls.length && !sectionRests.length) continue
      lines.push(`use ${track.id}`)
      const gestures: { order: number; line: string }[] = []
      for (const control of sectionControls) {
        const localBar = control.measure - section.start + 1
        const beat = control.offset / beatUnit + 1
        const values = [
          control.expression === undefined ? "" : `expression=${formatNumber(control.expression)}`,
          control.brightness === undefined ? "" : `brightness=${formatNumber(control.brightness)}`,
          control.vibrato === undefined ? "" : `vibrato=${formatNumber(control.vibrato)}`,
          control.pedal === undefined ? "" : `pedal=${control.pedal ? "down" : "up"}`,
          `ramp=${formatNumber(clamp(control.ramp, 0, 64))}`,
        ].filter(Boolean).join(" ")
        gestures.push({ order: control.measure * 1_000_000 + control.offset * 1_000, line: `control ${localBar}:${formatNumber(beat)} ${values}` })
      }
      for (const rest of sectionRests) {
        const localBar = rest.measure - section.start + 1
        const beat = rest.offset / beatUnit + 1
        gestures.push({ order: rest.measure * 1_000_000 + rest.offset * 1_000 + 1, line: `rest ${localBar}:${formatNumber(beat)} ${formatNumber(clamp(rest.duration, 0.03125, 256))}` })
      }
      for (const note of sectionNotes) {
        const localBar = note.measure - section.start + 1
        const beat = note.offset / beatUnit + 1
        gestures.push({ order: note.measure * 1_000_000 + note.offset * 1_000 + 2, line: `${localBar}:${formatNumber(beat)} ${note.notes.map(midiName).join(",")} ${formatNumber(clamp(note.duration, 0.03125, 256))} velocity=${formatNumber(note.velocity)} articulation=${note.articulation}${note.timbre === "natural" ? "" : ` timbre=${note.timbre}`}` })
      }
      gestures.sort((left, right) => left.order - right.order || left.line.localeCompare(right.line)).forEach(gesture => lines.push(gesture.line))
    }
    lines.push("end")
  }
  const source = lines.join("\n").trim()
  if (source.length > TLOQUE_SCORE_V2_LIMITS.sourceCharacters) throw new Error(`La conversión produce ${(source.length / 1024 / 1024).toFixed(1)} MB de TloqueScore; el límite es ${(TLOQUE_SCORE_V2_LIMITS.sourceCharacters / 1024 / 1024).toFixed(1)} MB`)
  const compiled = compileTloqueScore(source)
  if (!compiled.ok) throw new Error(`MusicXML se convirtió, pero TloqueScore rechazó el resultado:\n${compiled.diagnostics.slice(0, 12).map(item => `L${item.line}: ${item.message}`).join("\n")}`)
  return {
    source,
    recipe: compiled.recipe,
    title: metadata.title,
    composer: metadata.composer,
    report: {
      format, sourcePath, sourceParts: descriptors.length, outputTracks: tracks.length, measures: measureCount,
      notes: compiled.recipe.plan.events.length, controls: compiled.recipe.version === 2 ? compiled.recipe.plan.controls.length : 0,
      sections: sections.length, mergedParts: tracks.reduce((sum, track) => sum + track.partIds.length, 0) - tracks.length, warnings: warnings.values(),
    },
  }
}

export function importMusicXmlText(xml: string, fileName = "partitura.musicxml"): MusicXmlImportResult {
  return importFromXml(xml.replace(/^\uFEFF/, ""), fileName, "musicxml", fileName)
}

export async function importMusicXmlBytes(bytes: Uint8Array, fileName: string): Promise<MusicXmlImportResult> {
  const zipped = /\.mxl$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b)
  if (zipped) {
    const extracted = await extractMusicXmlFromMxl(bytes)
    return importFromXml(extracted.xml, fileName, "mxl", extracted.path)
  }
  if (bytes.byteLength > MAX_XML_BYTES) throw new Error("El archivo MusicXML supera 12 MB")
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")
  return importFromXml(xml, fileName, "musicxml", fileName)
}

export async function importMusicXmlFile(file: File): Promise<MusicXmlImportResult> {
  return importMusicXmlBytes(new Uint8Array(await file.arrayBuffer()), file.name)
}
