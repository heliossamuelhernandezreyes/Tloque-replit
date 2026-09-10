import type { LinearScoreRecipe } from "@shared/audio"
import type { PerformancePlan } from "@/audio/PerformanceEngine"

export const SCORE_SKILL_URL = "/downloads/TLOQUE_SCORE_AI_SKILL.md"
export const AUTO_COMPILE_MAX_CHARACTERS = 160_000
const INSTRUMENT_NAMES: Record<string, string> = {
  "strings.violin": "Violín solista", "strings.violin-section": "Sección de violines", "strings.viola": "Viola",
  "strings.cello": "Chelo", "strings.contrabass": "Contrabajo", "strings.harp": "Arpa",
  "woodwinds.flute": "Flauta", "woodwinds.piccolo": "Piccolo", "woodwinds.oboe": "Oboe",
  "woodwinds.clarinet": "Clarinete", "woodwinds.bass-clarinet": "Clarinete bajo", "woodwinds.bassoon": "Fagot",
  "woodwinds.ocarina": "Ocarina", "woodwinds.alto-recorder": "Flauta dulce alto",
  "brass.trumpet": "Trompeta", "brass.horn": "Trompa", "brass.trombone": "Trombón",
  "brass.bass-trombone": "Trombón bajo", "brass.tuba": "Tuba", "piano.grand": "Piano de cola",
  "keys.pipe-organ": "Órgano", "keys.pipe-organ-soft": "Órgano suave", "keys.pipe-organ-pedal": "Pedales de órgano",
  "keys.harpsichord": "Clavecín", "keys.celesta": "Celesta", "guitar.electric-clean": "Guitarra eléctrica limpia",
  "guitar.acoustic": "Guitarra acústica", "percussion.timpani": "Timbales", "percussion.orchestral-kit": "Percusión orquestal",
  "percussion.glockenspiel": "Glockenspiel", "percussion.marimba": "Marimba", "percussion.xylophone": "Xilófono", "percussion.tubular-bells": "Campanas tubulares",
}
export function scoreInstrumentName(id: string): string { return INSTRUMENT_NAMES[id] ?? id }
export type ScoreDiagnostic = { line: number; message: string }
export type ComposerBrief = {
  purpose: "reading" | "concert"
  mood: string
  seconds: number
  meter: "4/4" | "3/4" | "6/8"
  bpm: number
  loop: boolean
  moduleId: "orchestra-synth" | "native-auto" | "builtin"
  instruments: string[]
}
export const DEFAULT_COMPOSER_BRIEF: ComposerBrief = {
  purpose: "reading", mood: "Fantasía serena, intimidad y un pequeño momento de asombro",
  seconds: 60, meter: "4/4", bpm: 64, loop: false, moduleId: "orchestra-synth",
  instruments: ["piano.grand", "strings.violin", "strings.cello"],
}

export function buildComposerBrief(brief: ComposerBrief): string {
  const [numerator, denominator] = brief.meter.split("/").map(Number)
  const bpm = Math.max(20, Math.min(300, Math.round(brief.bpm) || 64))
  const bars = Math.max(1, Math.round(brief.seconds * bpm / (60 * numerator * 4 / denominator)))
  return [
    "ENCARGO DEL COMPOSITOR TLOQUE · skill 3.9.1",
    `Crea una obra instrumental original para ${brief.purpose === "reading" ? "acompañar lectura: baja densidad, sin sobresaltos ni promesas cognitivas" : "escucha protagonista, con contraste y dirección musical"}.`,
    `Carácter: ${brief.mood.trim().slice(0, 600) || "Sereno, con dirección musical"}.`,
    `Duración objetivo: aproximadamente ${brief.seconds} s. Compás ${brief.meter}; tempo ${bpm} negras por minuto. Orientación: ${bars} compases antes de rubato y colas.`,
    `Instrumentos permitidos: ${[...new Set(brief.instruments)].join(", ") || "piano.grand"}. No añadas otras familias.`,
    `Fuente solicitada: module ${brief.moduleId}; quality master; loop ${brief.loop}.`,
    brief.moduleId === "native-auto"
      ? "Disponibilidad de bancos: NO COMPROBADA por este encargo. No afirmes que están instalados; la obra requerirá sus bancos."
      : "La fuente elegida funciona sin descargar bancos instrumentales. No la describas como grabación acústica.",
    "Diseña un motivo reconocible, transformación, regreso y cierre; para un bucle, cierre compatible con la apertura. Reserva un clímax principal.",
    "Roles fijos por pista; relevo temático con descansos. Vientos monofónicos. Separa registros y usa controles propios de cada familia.",
    "Revisa sintaxis, duración, voicing, respiraciones y forma con la skill. Conserva un seed fijo. Devuelve la obra completa en un único bloque tloque-score, sin explicación ni comandos inventados.",
  ].join("\n")
}

/** Strip a single complete AI code block, never concatenate or truncate alternatives. */
export function normalizeScoreInput(value: string): string {
  const normalized = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim()
  const fences = [...normalized.matchAll(/^\s*```[^\n]*$/gm)]
  const score = normalized.match(/(?:^|\n)[ \t]*```tloque-score[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?:\n|$)/i)
  return fences.length === 2 && score ? score[1].trim() : normalized
}

export function scoreLineRange(source: string, line: number): { start: number; end: number } {
  const lines = source.split("\n")
  const index = Math.max(0, Math.min(lines.length - 1, Number.isFinite(line) ? Math.floor(line) - 1 : 0))
  let start = 0
  for (let i = 0; i < index; i++) start += lines[i].length + 1
  return { start, end: start + lines[index].length }
}

export function buildScoreRepairPrompt(source: string, diagnostics: readonly ScoreDiagnostic[]): string {
  return [
    "Repara esta obra TloqueScore 2 usando la skill adjunta. Conserva intención, instrumentos, notas válidas y seed; cambia sólo la causa del error.",
    "Devuelve la obra completa en un único bloque tloque-score y nada más. Los números L son líneas de código, no compases.",
    "DIAGNÓSTICOS", ...diagnostics.map(item => `L${item.line}: ${item.message}`),
    "FUENTE COMPLETA", source,
  ].join("\n")
}

export function activeScoreTrack(source: string, offset: number): { id: string; instrument: string } | null {
  const prefix = source.slice(0, offset)
  const sectionStart = prefix.lastIndexOf("\nsection ")
  const sectionPrefix = prefix.slice(Math.max(0, sectionStart))
  if (!/^section\s/m.test(sectionPrefix) || /^end\s*$/m.test(sectionPrefix)) return null
  const use = [...sectionPrefix.matchAll(/^use\s+([a-z][a-z0-9_-]*)\s*$/gm)].at(-1)
  if (!use) return null
  const track = source.split("\n").find(line => line.startsWith(`track ${use[1]} `))
  const instrument = track?.match(/\binstrument=(\S+)/)?.[1]
  return instrument ? { id: use[1], instrument } : null
}

export function snippetFitsInstrument(snippet: string, instrument: string): boolean {
  const bowed = instrument.startsWith("strings.") && instrument !== "strings.harp"
  const air = instrument.startsWith("woodwinds.") || instrument.startsWith("brass.")
  if (/\b(bow|pressure)=[\d.]+.*\bcoupling=|\bbow=|articulation=(spiccato|pizzicato|tremolo|harmonic)/.test(snippet)) return bowed
  if (/\bembouchure=/.test(snippet)) return air
  if (/\bpluck=/.test(snippet)) return instrument === "strings.harp" || instrument.startsWith("guitar.")
  if (/\bpedal=/.test(snippet)) return instrument === "piano.grand" || instrument === "keys.celesta"
  return true
}

export function summarizeScore(recipe: LinearScoreRecipe) {
  const tracks = recipe.plan.tracks.map(track => ({
    id: track.id, instrument: "instrument" in track ? track.instrument : track.synth,
    role: "role" in track ? track.role : "harmony", events: 0, pitches: 0, controls: 0,
    minMidi: 128, maxMidi: -1,
  }))
  const byTrack = new Map(tracks.map(track => [track.id, track]))
  for (const event of recipe.plan.events) {
    const track = byTrack.get(event.trackId)
    if (!track) continue
    track.events++
    track.pitches += event.notes.length
    for (const pitch of event.notes) { track.minMidi = Math.min(track.minMidi, pitch); track.maxMidi = Math.max(track.maxMidi, pitch) }
  }
  if (recipe.version === 2) for (const control of recipe.plan.controls) { const track = byTrack.get(control.trackId); if (track) track.controls++ }
  return {
    tracks, events: recipe.plan.events.length, pitches: tracks.reduce((sum, track) => sum + track.pitches, 0),
    seconds: recipe.version === 2 ? recipe.plan.totalSeconds : recipe.plan.totalBeats * 60 / recipe.plan.bpm,
    sections: recipe.version === 2 ? recipe.plan.sections.map(section => ({
      id: section.id, form: section.form, startBar: section.startBar, bars: section.bars * section.repeat,
      repeat: section.repeat, bpm: section.bpm, meter: section.meter ?? recipe.plan.meter,
    })) : [],
  }
}

export function summarizeInterpretation(plan: PerformancePlan) {
  const byTrack = new Map<string, { trackId: string; phrases: Set<number>; breaths: number; climaxes: number; tension: number; events: number }>()
  for (const event of plan.events) {
    let track = byTrack.get(event.trackId)
    if (!track) { track = { trackId: event.trackId, phrases: new Set(), breaths: 0, climaxes: 0, tension: 0, events: 0 }; byTrack.set(event.trackId, track) }
    track.phrases.add(event.phraseIndex)
    track.breaths += Number(event.interpretation.breathReset)
    track.climaxes += Number(event.interpretation.phrasePhase === "climax")
    track.tension += event.interpretation.harmonicTension
    track.events++
  }
  return [...byTrack.values()].map(({ phrases, tension, events, ...track }) => ({ ...track, phrases: phrases.size, tension: tension / Math.max(1, events) }))
}

export type BankRequirement = { moduleId: string | null; instruments: string[] }
export type BankCheck = BankRequirement & { status: "available" | "missing" | "unknown"; detail: string }

/** Metadata only. Does not download PCM or claim offline/sample/articulation coverage. */
export async function checkRequiredBanks(requirements: readonly BankRequirement[], signal?: AbortSignal, request: typeof fetch = fetch): Promise<BankCheck[]> {
  const results: BankCheck[] = []
  // Sequential bounded requests avoid a burst against the shared sample route.
  for (const requirement of requirements) {
    if (signal?.aborted) throw new DOMException("Comprobación cancelada", "AbortError")
    if (!requirement.moduleId) { results.push({ ...requirement, status: "missing", detail: "Sin ruta nativa verificada" }); continue }
    const requestAbort = new AbortController()
    const cancel = () => requestAbort.abort()
    signal?.addEventListener("abort", cancel, { once: true })
    const timeout = setTimeout(cancel, 8_000)
    try {
      const response = await request(`/api/audio/sample-packs/modules/${encodeURIComponent(requirement.moduleId)}.json`, { credentials: "include", cache: "no-store", signal: requestAbort.signal })
      if (response.status === 404) { results.push({ ...requirement, status: "missing", detail: "Manifiesto no publicado" }); continue }
      if (!response.ok) { results.push({ ...requirement, status: "unknown", detail: `No comprobado · HTTP ${response.status}` }); continue }
      const body = await response.json()
      const available = body?.instrumentManifestId === requirement.moduleId && Array.isArray(body.zones) && body.zones.length > 0
      results.push({ ...requirement, status: available ? "available" : "unknown", detail: available ? "Manifiesto accesible · PCM sin comprobar" : "Metadatos inesperados; no se ha confirmado el banco" })
    } catch (error) {
      if (signal?.aborted) throw error
      results.push({ ...requirement, status: "unknown", detail: "Sin respuesta; no equivale a banco ausente" })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", cancel)
    }
  }
  return results
}
