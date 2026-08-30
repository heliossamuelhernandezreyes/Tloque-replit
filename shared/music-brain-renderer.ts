import {
  MUSIC_BRAIN_CONTENT_MODE,
  MUSIC_BRAIN_KNOWLEDGE_VERSION,
  MUSIC_BRAIN_RULE_VERSION,
  compileMusicBrainScore,
  notesForMusicBrainRegion,
  stableMusicBrainHash,
  type MusicBrainNoteEventV1,
  type MusicBrainScoreV1,
} from "./music-brain"
import {
  TLOQUE_SCORE_COMPILER_V2,
  compileTloqueScoreV2,
  type LinearScoreRecipeV2,
  type LinearScoreTrackV2,
} from "./tloque-score-v2"

export const MUSIC_BRAIN_RENDERER_VERSION = "tloque-music-brain-renderer-v2" as const

export interface MusicBrainRegionRenderV1 {
  rendererVersion: typeof MUSIC_BRAIN_RENDERER_VERSION
  ruleVersion: typeof MUSIC_BRAIN_RULE_VERSION
  knowledgeVersion: typeof MUSIC_BRAIN_KNOWLEDGE_VERSION
  contentMode: typeof MUSIC_BRAIN_CONTENT_MODE
  regionId: string
  silence: boolean
  recipe: LinearScoreRecipeV2 | null
}

const BASE_TRACKS: Record<MusicBrainNoteEventV1["voice"], LinearScoreTrackV2> = {
  foundation: {
    id: "foundation", synth: "pad", instrument: "strings.cello", program: 42, role: "harmony",
    gain: 0.24, pan: -0.12, attack: 0.9, release: 4.2, expression: 0.72, brightness: 0.34,
    vibrato: 0.06, timbre: "non-vibrato",
  },
  motion: {
    id: "motion", synth: "warm", instrument: "piano.grand", program: 0, role: "pulse",
    gain: 0.16, pan: 0.08, attack: 0.035, release: 1.6, expression: 0.64, brightness: 0.48,
    vibrato: 0, timbre: "natural",
  },
  leitmotif: {
    id: "leitmotif", synth: "pad", instrument: "strings.violin", program: 40, role: "melody",
    gain: 0.17, pan: 0.16, attack: 0.22, release: 2.4, expression: 0.62, brightness: 0.52,
    vibrato: 0.1, timbre: "expression-vibrato",
  },
}

type Voice = MusicBrainNoteEventV1["voice"]
type InstrumentChoice = Pick<LinearScoreTrackV2, "instrument" | "program" | "synth" | "timbre">

const CHOICES = {
  foundation: {
    air_pad: [
      { instrument: "strings.violin-section", program: 48, synth: "pad", timbre: "non-vibrato" },
      { instrument: "strings.harp", program: 46, synth: "pluck", timbre: "natural" },
      { instrument: "woodwinds.clarinet", program: 71, synth: "warm", timbre: "natural" },
    ],
    warm_pad: [
      { instrument: "strings.viola", program: 41, synth: "pad", timbre: "expression-vibrato" },
      { instrument: "strings.cello", program: 42, synth: "pad", timbre: "non-vibrato" },
      { instrument: "keys.pipe-organ-soft", program: 19, synth: "pad", timbre: "natural" },
    ],
    dark_pad: [
      { instrument: "strings.cello", program: 42, synth: "pad", timbre: "non-vibrato" },
      { instrument: "woodwinds.bassoon", program: 70, synth: "warm", timbre: "natural" },
      { instrument: "brass.horn", program: 60, synth: "pad", timbre: "natural" },
    ],
  },
  motion: {
    felt_keys: [
      { instrument: "piano.grand", program: 0, synth: "warm", timbre: "natural" },
      { instrument: "strings.harp", program: 46, synth: "pluck", timbre: "natural" },
      { instrument: "guitar.acoustic", program: 25, synth: "pluck", timbre: "natural" },
    ],
    muted_pluck: [
      { instrument: "guitar.acoustic", program: 25, synth: "pluck", timbre: "natural" },
      { instrument: "strings.harp", program: 46, synth: "pluck", timbre: "natural" },
      { instrument: "percussion.marimba", program: 12, synth: "bell", timbre: "natural" },
    ],
    soft_bell: [
      { instrument: "keys.celesta", program: 8, synth: "bell", timbre: "natural" },
      { instrument: "percussion.glockenspiel", program: 9, synth: "bell", timbre: "natural" },
      { instrument: "percussion.marimba", program: 12, synth: "bell", timbre: "natural" },
    ],
  },
  motif: {
    felt_keys: [
      { instrument: "woodwinds.clarinet", program: 71, synth: "warm", timbre: "natural" },
      { instrument: "strings.violin", program: 40, synth: "pad", timbre: "expression-vibrato" },
      { instrument: "woodwinds.alto-recorder", program: 74, synth: "warm", timbre: "natural" },
    ],
    soft_bell: [
      { instrument: "woodwinds.oboe", program: 68, synth: "warm", timbre: "natural" },
      { instrument: "woodwinds.flute", program: 73, synth: "warm", timbre: "vibrato" },
      { instrument: "keys.celesta", program: 8, synth: "bell", timbre: "natural" },
    ],
  },
} as const

const INSTRUMENT_RANGES: Record<string, readonly [number, number]> = {
  "strings.violin-section": [55, 96], "strings.viola": [48, 88], "strings.cello": [36, 76], "strings.harp": [36, 96],
  "woodwinds.clarinet": [50, 94], "woodwinds.bassoon": [34, 75], "woodwinds.oboe": [58, 88], "woodwinds.flute": [60, 96],
  "woodwinds.alto-recorder": [60, 88], "brass.horn": [41, 77], "keys.pipe-organ-soft": [36, 84], "piano.grand": [24, 108],
  "guitar.acoustic": [40, 88], "percussion.marimba": [45, 96], "percussion.glockenspiel": [72, 96], "keys.celesta": [48, 96],
}

function normalizedTags(tags: readonly string[]) {
  return tags.map(tag => tag.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
}

function familyOverride(voice: Voice, tags: readonly string[]): InstrumentChoice | null {
  const joined = normalizedTags(tags).join(" ")
  if (/cuerda|string/.test(joined)) return voice === "foundation"
    ? { instrument: "strings.cello", program: 42, synth: "pad", timbre: "non-vibrato" }
    : voice === "motion" ? { instrument: "strings.harp", program: 46, synth: "pluck", timbre: "natural" }
      : { instrument: "strings.violin", program: 40, synth: "pad", timbre: "expression-vibrato" }
  if (/madera|woodwind|viento/.test(joined)) return voice === "foundation"
    ? { instrument: "woodwinds.bassoon", program: 70, synth: "warm", timbre: "natural" }
    : voice === "motion" ? { instrument: "woodwinds.alto-recorder", program: 74, synth: "warm", timbre: "natural" }
      : { instrument: "woodwinds.clarinet", program: 71, synth: "warm", timbre: "natural" }
  if (/metal|brass|corno|horn/.test(joined)) return voice === "foundation"
    ? { instrument: "brass.horn", program: 60, synth: "pad", timbre: "natural" }
    : null
  if (/piano|tecla|keys/.test(joined)) return voice === "foundation"
    ? { instrument: "keys.pipe-organ-soft", program: 19, synth: "pad", timbre: "natural" }
    : voice === "motion" ? { instrument: "piano.grand", program: 0, synth: "warm", timbre: "natural" }
      : { instrument: "keys.celesta", program: 8, synth: "bell", timbre: "natural" }
  if (/guitarr|guitar/.test(joined) && voice === "motion") return { instrument: "guitar.acoustic", program: 25, synth: "pluck", timbre: "natural" }
  if (/percusi|percussion|ritmic/.test(joined) && voice === "motion") return { instrument: "percussion.marimba", program: 12, synth: "bell", timbre: "natural" }
  return null
}

function orchestrationForRegion(
  input: MusicBrainScoreV1,
  region: ReturnType<typeof compileMusicBrainScore>["plan"]["regions"][number],
  tags: readonly string[],
): Record<Voice, LinearScoreTrackV2> {
  const selectionSalt = `${input.seed}:${region.regionId}:${region.scoreId ?? "procedural"}:${region.layerIds.join(",")}`
  const pick = (items: readonly InstrumentChoice[], voice: Voice) => items[stableMusicBrainHash(`${selectionSalt}:${voice}`) % items.length]
  const choices: Record<Voice, InstrumentChoice> = {
    foundation: familyOverride("foundation", tags) ?? pick(CHOICES.foundation[region.instruments.foundation] as readonly InstrumentChoice[], "foundation"),
    motion: familyOverride("motion", tags) ?? pick(CHOICES.motion[region.instruments.motion] as readonly InstrumentChoice[], "motion"),
    leitmotif: familyOverride("leitmotif", tags) ?? pick(CHOICES.motif[region.instruments.motif] as readonly InstrumentChoice[], "leitmotif"),
  }
  return Object.fromEntries((Object.keys(BASE_TRACKS) as Voice[]).map(voice => [voice, { ...BASE_TRACKS[voice], ...choices[voice] }])) as Record<Voice, LinearScoreTrackV2>
}

function fitInstrumentRange(midi: number, instrument: string) {
  const [minimum, maximum] = INSTRUMENT_RANGES[instrument] ?? [36, 96]
  let fitted = midi
  while (fitted < minimum) fitted += 12
  while (fitted > maximum) fitted -= 12
  return Math.max(minimum, Math.min(maximum, fitted))
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function sectionIdFor(regionId: string): string {
  const normalized = regionId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "")
  const base = /^[a-z]/.test(normalized) ? normalized : `r-${normalized}`
  return `${base.slice(0, 22)}-${fnv1a(regionId).slice(0, 8)}`.slice(0, 32)
}

function articulationFor(event: MusicBrainNoteEventV1) {
  if (event.voice === "foundation") return "tenuto" as const
  if (event.voice === "leitmotif") return "legato" as const
  return "normal" as const
}

function numberToken(value: number): string {
  return String(Number(value.toFixed(6)))
}

function noteToken(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/**
 * Deterministic adapter from the canonical Music Brain pipeline into the
 * TloqueScore renderer contract. It renders one narrative region at a time so
 * long chapters are not forced into TloqueScore's bounded movement limits.
 */
export function renderMusicBrainRegion(
  input: MusicBrainScoreV1,
  requestedRegionId?: string | null,
): MusicBrainRegionRenderV1 {
  const compilation = compileMusicBrainScore(input)
  const region = compilation.plan.regions.find(candidate => candidate.regionId === requestedRegionId)
    ?? compilation.plan.regions[0]
  const base = {
    rendererVersion: MUSIC_BRAIN_RENDERER_VERSION,
    ruleVersion: MUSIC_BRAIN_RULE_VERSION,
    knowledgeVersion: MUSIC_BRAIN_KNOWLEDGE_VERSION,
    contentMode: MUSIC_BRAIN_CONTENT_MODE,
    regionId: region.regionId,
    silence: region.silence,
  } as const
  if (region.silence) return { ...base, recipe: null }

  const sectionId = sectionIdFor(region.regionId)
  const beatsPerBar = region.meter[0]
  const beatSeconds = 60 / region.bpm
  const directionRegion = input.regions.find(candidate => candidate.id === region.regionId)
  const tracks = orchestrationForRegion(input, region, directionRegion?.layerTags ?? [])
  const notes = notesForMusicBrainRegion(compilation.timeline, region.regionId)
  const grouped = new Map<string, MusicBrainNoteEventV1[]>()
  for (const note of notes) {
    const relativeBeat = clamp(note.beat - region.startBeat, 0, region.durationBeats)
    const key = `${note.voice}:${relativeBeat.toFixed(6)}:${note.durationBeats.toFixed(6)}`
    const group = grouped.get(key) ?? []
    group.push(note)
    grouped.set(key, group)
  }

  const events = [...grouped.values()].map(group => {
    const first = group[0]
    const relativeBeat = clamp(first.beat - region.startBeat, 0, region.durationBeats)
    const durationBeats = clamp(first.durationBeats, 0.03125, Math.max(0.03125, region.durationBeats - relativeBeat))
    return {
      trackId: tracks[first.voice].id,
      bar: Math.floor(relativeBeat / beatsPerBar) + 1,
      beat: relativeBeat % beatsPerBar + 1,
      durationBeats,
      notes: [...new Set(group.map(note => fitInstrumentRange(note.midi, tracks[first.voice].instrument)))].sort((left, right) => left - right),
      velocity: clamp(Math.max(...group.map(note => note.velocity)), 0.01, 0.42),
      articulation: articulationFor(first),
      timbre: tracks[first.voice].timbre,
    }
  }).sort((left, right) => left.bar - right.bar || left.beat - right.beat || left.trackId.localeCompare(right.trackId))

  const totalBars = Math.max(1, Math.ceil(region.durationBeats / beatsPerBar))
  const controls = (Object.values(tracks) as LinearScoreTrackV2[]).map(track => ({
    trackId: track.id,
    rampBeats: Math.min(4, Math.max(0, (directionRegion?.transitionSeconds ?? 1) / beatSeconds)),
    expression: clamp(track.expression * (0.72 + region.intensity * 0.35), 0, 1),
    brightness: clamp(track.brightness + (region.texture === "dark" ? -0.14 : region.intensity * 0.1), 0, 1),
    vibrato: track.id === "leitmotif" ? clamp(0.05 + region.intensity * 0.2, 0, 1) : track.vibrato,
    pedal: track.id === "motion" ? true : null,
    damper: track.id === "motion" ? 0.68 : null,
    sympatheticCoupling: track.id === "motion" ? 0.42 : null,
  }))
  const safeTitle = region.regionId.replace(/["\r\n]/g, " ").slice(0, 96)
  const source = [
    "TLOQUE_SCORE 2",
    `title "Music Brain · ${safeTitle}" // renderer=${MUSIC_BRAIN_RENDERER_VERSION} score=${input.version} rule=${input.ruleVersion} knowledge=${input.knowledgeVersion} content=${input.contentMode} book=${input.bookId} chapter=${input.chapterIndex} revision=${input.sourceRevision} region=${fnv1a(region.regionId)}`,
    `tempo ${region.bpm}`,
    `meter ${region.meter[0]}/${region.meter[1]}`,
    "loop true",
    `seed ${input.seed}`,
    "humanize 0",
    "quality studio",
    "module native-auto",
    ...Object.values(tracks).map(track =>
      `track ${track.id} synth=${track.synth} instrument=${track.instrument} program=${track.program} role=${track.role} gain=${numberToken(track.gain)} pan=${numberToken(track.pan)} attack=${numberToken(track.attack)} release=${numberToken(track.release)} expression=${numberToken(track.expression)} brightness=${numberToken(track.brightness)} vibrato=${numberToken(track.vibrato)} timbre=${track.timbre}`),
    `section ${sectionId} form=custom bars=${totalBars} repeat=1 fade=${Math.min(16, beatsPerBar)} tempo=${region.bpm} rubato=0`,
    ...Object.values(tracks).flatMap(track => {
      const control = controls.find(candidate => candidate.trackId === track.id)!
      const controlTokens = [
        `expression=${numberToken(control.expression)}`,
        `brightness=${numberToken(control.brightness)}`,
        `vibrato=${numberToken(control.vibrato)}`,
        `ramp=${numberToken(control.rampBeats)}`,
        ...(control.pedal === true ? ["pedal=down"] : []),
        ...(control.damper !== null ? [`damper=${numberToken(control.damper)}`] : []),
        ...(control.sympatheticCoupling !== null ? [`coupling=${numberToken(control.sympatheticCoupling)}`] : []),
      ]
      const trackEvents = events.filter(event => event.trackId === track.id).map(event =>
        `${event.bar}:${numberToken(event.beat)} ${event.notes.map(noteToken).join(",")} ${numberToken(event.durationBeats)} velocity=${numberToken(event.velocity)} articulation=${event.articulation} timbre=${event.timbre}`)
      return [`use ${track.id}`, `control 1:1 ${controlTokens.join(" ")}`, ...trackEvents]
    }),
    "end",
  ].join("\n")
  const compiled = compileTloqueScoreV2(source)
  if (!compiled.ok || compiled.recipe.plan.compilerVersion !== TLOQUE_SCORE_COMPILER_V2) {
    const detail = compiled.ok ? "versión inesperada" : compiled.diagnostics.map(item => `${item.line}:${item.message}`).join(" | ")
    throw new Error(`Music Brain produjo una partitura inválida: ${detail}`)
  }
  const recipe = compiled.recipe
  return { ...base, recipe }
}
