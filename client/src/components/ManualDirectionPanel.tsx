import { useEffect, useMemo, useState } from "react"
import {
  Check,
  EyeOff,
  Loader2,
  Lock,
  Mic2,
  Music2,
  Plus,
  Save,
  Trash2,
  Unlock,
  UploadCloud,
  UserRound,
} from "lucide-react"
import { apiRequest } from "@/lib/queryClient"
import { narrativeParagraphsFor, type NarrativeMood, type NarrativeRegionV1 } from "@shared/narrative"
import { speechDeliverySchema, type SpeechCharacterV1, type SpeechDelivery, type SpeechSpanV1 } from "@shared/speech"
import {
  createEmptyAdvancedDirection,
  defaultMusicNode,
  defaultVoiceNote,
  directionEmotionSchema,
  directionProjectionSchema,
  directionVocalStateSchema,
  manualNarrationSpans,
  type AdvancedDirectionProjectV2,
  type DirectionMusicNodeV2,
  type DirectionVoiceNoteV2,
} from "@shared/direction"

interface DirectionResponse {
  contentHash: string
  language: string
  currentRevision: number
  project: AdvancedDirectionProjectV2 | null
  stale: boolean
}

interface VoiceOption {
  id: number
  label: string
  language: string
  role: "narrator" | "dialogue" | "both"
}

interface ScoreOption {
  id: number
  title: string
  bpm: number
}

type Busy = "load" | "save" | "compile" | "publish" | null

const MOODS: NarrativeMood[] = [
  "neutral", "calm", "wonder", "melancholy", "rising_tension",
  "confrontation", "climax", "release", "silence",
]

function messageFor(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const jsonStart = error.message.indexOf("{")
  if (jsonStart >= 0) {
    try { return JSON.parse(error.message.slice(jsonStart))?.message || fallback } catch { /* fallback */ }
  }
  return error.message || fallback
}

function nextCharacter(project: AdvancedDirectionProjectV2): SpeechCharacterV1 {
  let index = project.voiceProject.characters.length + 1
  while (project.voiceProject.characters.some(character => character.id === `personaje_${index}`)) index += 1
  return {
    id: `personaje_${index}`,
    name: `Personaje ${index}`,
    aliases: [],
    voiceProfileId: null,
    confidence: 1,
    source: "manual",
    locked: false,
  }
}

function firstFreeParagraph(regions: readonly NarrativeRegionV1[], paragraphCount: number): number | null {
  const occupied = new Set<number>()
  for (const region of regions) {
    for (let index = region.startParagraph; index <= region.endParagraph; index++) occupied.add(index)
  }
  for (let index = 0; index < paragraphCount; index++) if (!occupied.has(index)) return index
  return null
}

function nextRegion(project: AdvancedDirectionProjectV2, paragraphCount: number): NarrativeRegionV1 | null {
  const start = firstFreeParagraph(project.musicProject.regions, paragraphCount)
  if (start === null) return null
  const occupied = new Set(project.musicProject.regions.flatMap(region => {
    const indexes: number[] = []
    for (let index = region.startParagraph; index <= region.endParagraph; index++) indexes.push(index)
    return indexes
  }))
  let end = start
  while (end + 1 < paragraphCount && end - start < 2 && !occupied.has(end + 1)) end += 1
  let serial = project.musicProject.regions.length + 1
  while (project.musicProject.regions.some(region => region.id === `manual_region_${start + 1}_${serial}`)) serial += 1
  return {
    id: `manual_region_${start + 1}_${serial}`,
    name: `Región ${serial}`,
    startParagraph: start,
    preferredParagraph: Math.floor((start + end) / 2),
    endParagraph: end,
    mood: "neutral",
    targetIntensity: 0.3,
    tension: 0.2,
    warmth: 0.5,
    density: 0.2,
    texture: "minimal",
    percussion: "none",
    transition: { minimumSeconds: 8, preferredSeconds: 14, maximumSeconds: 24 },
    scoreId: null,
    layerTags: [],
    confidence: 1,
    source: "manual",
    locked: false,
    note: "",
  }
}

export default function ManualDirectionPanel({
  bookId,
  chapterIndex,
  content,
  accent,
}: {
  bookId: number
  chapterIndex: number
  content: string
  accent: string
}) {
  const paragraphs = useMemo(() => narrativeParagraphsFor(content), [content])
  const [project, setProject] = useState<AdvancedDirectionProjectV2 | null>(null)
  const [currentRevision, setCurrentRevision] = useState(0)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [scores, setScores] = useState<ScoreOption[]>([])
  const [busy, setBusy] = useState<Busy>("load")
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState("")
  const [staleRecovered, setStaleRecovered] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBusy("load")
    setNotice("")
    Promise.all([
      fetch(`/api/books/${bookId}/direction/${chapterIndex}`, { credentials: "include" }),
      fetch("/api/voices", { credentials: "include" }),
      fetch("/api/audio/scores", { credentials: "include" }),
    ]).then(async ([directionResponse, voiceResponse, scoreResponse]) => {
      if (!directionResponse.ok) throw new Error(await directionResponse.text())
      const direction = await directionResponse.json() as DirectionResponse
      const voiceData = voiceResponse.ok ? await voiceResponse.json() as { voices: VoiceOption[] } : { voices: [] }
      const scoreData = scoreResponse.ok ? await scoreResponse.json() as { scores: ScoreOption[] } : { scores: [] }
      if (cancelled) return
      const next = direction.project ?? createEmptyAdvancedDirection({
        bookId,
        chapterIndex,
        contentHash: direction.contentHash,
        language: direction.language || "es",
        revision: Math.max(1, direction.currentRevision),
      })
      setProject(next)
      setCurrentRevision(direction.currentRevision)
      setVoices(voiceData.voices || [])
      setScores(scoreData.scores || [])
      setDirty(false)
      setStaleRecovered(direction.stale)
      setNotice(direction.stale ? "La partitura anterior pertenecía a otra versión del capítulo. Esta edición comenzará sobre el texto actual." : "")
    }).catch(error => !cancelled && setNotice(messageFor(error, "No se pudo cargar la dirección manual")))
      .finally(() => !cancelled && setBusy(null))
    return () => { cancelled = true }
  }, [bookId, chapterIndex])

  function change(update: (current: AdvancedDirectionProjectV2) => AdvancedDirectionProjectV2) {
    setProject(current => current ? update(current) : current)
    setDirty(true)
  }

  function addBaseNarration() {
    if (!project || project.voiceProject.spans.length > 0) return
    const spans = manualNarrationSpans(project.contentHash, paragraphs)
    change(current => ({
      ...current,
      voiceProject: { ...current.voiceProject, spans },
      voiceNotes: spans.map(defaultVoiceNote),
    }))
  }

  function updateCharacter(id: string, patch: Partial<SpeechCharacterV1>) {
    change(current => ({
      ...current,
      voiceProject: {
        ...current.voiceProject,
        characters: current.voiceProject.characters.map(character => character.id === id ? { ...character, ...patch, source: "manual" } : character),
      },
    }))
  }

  function removeCharacter(id: string) {
    if (!project || project.voiceProject.spans.some(span => span.speakerId === id)) {
      setNotice("Asigna primero sus fragmentos a otro personaje o al narrador.")
      return
    }
    change(current => ({
      ...current,
      voiceProject: { ...current.voiceProject, characters: current.voiceProject.characters.filter(character => character.id !== id) },
    }))
  }

  function updateSpan(id: string, patch: Partial<SpeechSpanV1>) {
    change(current => ({
      ...current,
      voiceProject: {
        ...current.voiceProject,
        spans: current.voiceProject.spans.map(span => span.id === id ? { ...span, ...patch, source: "manual" } : span),
      },
      voiceNotes: current.voiceNotes.map(note => note.spanId === id && patch.locked !== undefined ? { ...note, locked: patch.locked } : note),
    }))
  }

  function updateVoiceNote(spanId: string, patch: Partial<DirectionVoiceNoteV2>) {
    change(current => ({
      ...current,
      voiceNotes: current.voiceNotes.map(note => note.spanId === spanId ? { ...note, ...patch, source: "manual" } : note),
      voiceProject: {
        ...current.voiceProject,
        spans: current.voiceProject.spans.map(span => span.id === spanId && patch.locked !== undefined ? { ...span, locked: patch.locked } : span),
      },
    }))
  }

  function addMusicRegion() {
    if (!project) return
    const region = nextRegion(project, paragraphs.length)
    if (!region) return setNotice("Todo el capítulo ya está cubierto por regiones musicales.")
    change(current => ({
      ...current,
      musicProject: { ...current.musicProject, regions: [...current.musicProject.regions, region] },
      musicNodes: [...current.musicNodes, defaultMusicNode(region)],
    }))
  }

  function updateRegion(id: string, patch: Partial<NarrativeRegionV1>) {
    change(current => ({
      ...current,
      musicProject: {
        ...current.musicProject,
        regions: current.musicProject.regions.map(region => {
          if (region.id !== id) return region
          const next = { ...region, ...patch, source: "manual" as const }
          const startParagraph = Math.min(next.startParagraph, next.endParagraph)
          const endParagraph = Math.max(next.startParagraph, next.endParagraph)
          return {
            ...next,
            startParagraph,
            endParagraph,
            preferredParagraph: Math.max(startParagraph, Math.min(next.preferredParagraph, endParagraph)),
            ...(next.mood === "silence" ? { scoreId: null, layerTags: [], percussion: "none" as const } : {}),
          }
        }),
      },
      musicNodes: current.musicNodes.map(node => node.regionId === id ? {
        ...node,
        source: "manual" as const,
        ...(patch.scoreId !== undefined ? { scoreId: patch.scoreId, layerIds: [] } : {}),
        ...(patch.mood === "silence" ? { scoreId: null, layerIds: [], exit: "fade_out" as const } : {}),
        ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
      } : node),
    }))
  }

  function updateMusicNode(regionId: string, patch: Partial<DirectionMusicNodeV2>) {
    change(current => ({
      ...current,
      musicNodes: current.musicNodes.map(node => node.regionId === regionId ? { ...node, ...patch, source: "manual" } : node),
      musicProject: {
        ...current.musicProject,
        regions: current.musicProject.regions.map(region => region.id === regionId && patch.locked !== undefined ? { ...region, locked: patch.locked } : region),
      },
    }))
  }

  function removeRegion(id: string) {
    change(current => ({
      ...current,
      musicProject: { ...current.musicProject, regions: current.musicProject.regions.filter(region => region.id !== id) },
      musicNodes: current.musicNodes.filter(node => node.regionId !== id),
    }))
  }

  async function saveProject() {
    if (!project) return
    setBusy("save")
    setNotice("")
    try {
      const { bookId: _bookId, chapterIndex: _chapter, revision: _revision, contentHash: _hash, ...editable } = project
      const response = await apiRequest("PUT", `/api/books/${bookId}/direction/${chapterIndex}`, {
        expectedRevision: currentRevision,
        project: editable,
      })
      const data = await response.json() as { project: AdvancedDirectionProjectV2 }
      setProject(data.project)
      setCurrentRevision(data.project.revision)
      setDirty(false)
      setStaleRecovered(false)
      setNotice("Partitura manual guardada.")
    } catch (error) {
      setNotice(messageFor(error, "No se pudo guardar la partitura"))
    } finally {
      setBusy(null)
    }
  }

  async function compileProjects() {
    setBusy("compile")
    setNotice("")
    try {
      await Promise.all([
        apiRequest("POST", `/api/books/${bookId}/speech/${chapterIndex}/compile`),
        apiRequest("POST", `/api/books/${bookId}/narrative/${chapterIndex}/compile`),
      ])
      setNotice("Voz y música están preparadas para previsualización.")
    } catch (error) {
      setNotice(messageFor(error, "No se pudo preparar toda la partitura"))
    } finally {
      setBusy(null)
    }
  }

  async function publishProjects() {
    setBusy("publish")
    setNotice("")
    try {
      await Promise.all([
        apiRequest("POST", `/api/books/${bookId}/speech/${chapterIndex}/publish`),
        apiRequest("POST", `/api/books/${bookId}/narrative/${chapterIndex}/publish`),
      ])
      setNotice("Dirección de audiolibro y música publicada.")
    } catch (error) {
      setNotice(messageFor(error, "No se pudo publicar toda la dirección"))
    } finally {
      setBusy(null)
    }
  }

  if (busy === "load" || !project) return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-white/35">
      <Loader2 className="h-4 w-4 animate-spin" /> Preparando edición manual…
    </div>
  )

  const narratorVoices = voices.filter(voice => voice.role !== "dialogue")
  const dialogueVoices = voices.filter(voice => voice.role !== "narrator")
  const inputClass = "min-h-10 w-full rounded-lg border border-white/[.07] bg-zinc-950 px-2.5 text-[11px] text-white/60 outline-none focus:border-violet-200/25"

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ color: accent, background: `${accent}14` }}><EyeOff className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white/80">Dirección manual</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-white/35">Edita actuación y música en la misma partitura. No usa IA ni consume Papel.</p>
          </div>
          <span className="rounded-lg border border-white/[.07] px-2 py-1 text-[9px] text-white/30">r{currentRevision}</span>
        </div>
        {staleRecovered && <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-3 text-[11px] text-amber-100/60">La versión anterior se conservará hasta que guardes esta nueva partitura.</p>}
      </div>

      <section className="space-y-3 rounded-2xl border border-white/[.07] bg-white/[.018] p-3.5 sm:p-4">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4" style={{ color: accent }} />
          <div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-white/70">Audiolibro</h3><p className="text-[10px] text-white/25">Voces, actuación y pausas</p></div>
          {project.voiceProject.spans.length === 0 && <button type="button" onClick={addBaseNarration} className="min-h-9 rounded-lg px-2.5 text-[10px]" style={{ color: accent, background: `${accent}12` }}>Crear base</button>}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[9px] uppercase tracking-wider text-white/30">Voz del narrador<select className={`${inputClass} mt-1`} value={project.voiceProject.narratorVoiceProfileId ?? ""} onChange={event => change(current => ({ ...current, voiceProject: { ...current.voiceProject, narratorVoiceProfileId: event.target.value ? Number(event.target.value) : null } }))}><option value="">Seleccionar voz</option>{narratorVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label} · {voice.language.toUpperCase()}</option>)}</select></label>
          <label className="text-[9px] uppercase tracking-wider text-white/30">Pausa entre párrafos<input className={`${inputClass} mt-1`} type="number" min={0} max={5000} value={project.voiceProject.paragraphPauseMs} onChange={event => change(current => ({ ...current, voiceProject: { ...current.voiceProject, paragraphPauseMs: Number(event.target.value) } }))} /></label>
        </div>

        <div className="space-y-2">
          {project.voiceProject.characters.map(character => (
            <div key={character.id} className="grid gap-2 rounded-xl border border-white/[.06] bg-black/20 p-3 sm:grid-cols-[1fr_1fr_auto]">
              <input className={inputClass} value={character.name} onChange={event => updateCharacter(character.id, { name: event.target.value })} />
              <select className={inputClass} value={character.voiceProfileId ?? ""} onChange={event => updateCharacter(character.id, { voiceProfileId: event.target.value ? Number(event.target.value) : null })}><option value="">Voz del personaje</option>{dialogueVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label} · {voice.language.toUpperCase()}</option>)}</select>
              <button type="button" onClick={() => removeCharacter(character.id)} className="grid min-h-10 place-items-center rounded-lg px-3 text-red-200/35" aria-label="Eliminar personaje"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => change(current => ({ ...current, voiceProject: { ...current.voiceProject, characters: [...current.voiceProject.characters, nextCharacter(current)] } }))} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[.07] px-3 text-[10px] text-white/40"><Plus className="h-3.5 w-3.5" /><UserRound className="h-3.5 w-3.5" />Personaje</button>
        </div>

        <div className="max-h-[38rem] space-y-2 overflow-y-auto pr-1">
          {project.voiceProject.spans.map(span => {
            const note = project.voiceNotes.find(candidate => candidate.spanId === span.id) ?? defaultVoiceNote(span)
            const excerpt = paragraphs[span.paragraphIndex]?.slice(span.startOffset, span.endOffset) || ""
            return (
              <div key={span.id} className="space-y-2 rounded-xl border border-white/[.06] bg-black/20 p-3">
                <div className="flex items-start gap-2"><p className="min-w-0 flex-1 line-clamp-3 font-serif text-xs leading-relaxed text-white/50">{excerpt}</p><button type="button" onClick={() => updateVoiceNote(span.id, { locked: !note.locked })} className="p-1.5 text-white/30" aria-label="Proteger indicación">{note.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select className={inputClass} value={span.speakerId} onChange={event => updateSpan(span.id, { speakerId: event.target.value, kind: event.target.value === "narrator" ? "narration" : "dialogue" })}><option value="narrator">Narrador</option>{project.voiceProject.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select>
                  <select className={inputClass} value={span.delivery} onChange={event => updateSpan(span.id, { delivery: event.target.value as SpeechDelivery })}>{speechDeliverySchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                  <label className="text-[9px] text-white/25">Pausa antes<input className={`${inputClass} mt-1`} type="number" min={0} max={5000} value={span.pauseBeforeMs} onChange={event => updateSpan(span.id, { pauseBeforeMs: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Pausa después<input className={`${inputClass} mt-1`} type="number" min={0} max={5000} value={span.pauseAfterMs} onChange={event => updateSpan(span.id, { pauseAfterMs: Number(event.target.value) })} /></label>
                  <select className={inputClass} value={note.emotion} onChange={event => updateVoiceNote(span.id, { emotion: event.target.value as DirectionVoiceNoteV2["emotion"] })}>{directionEmotionSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                  <select className={inputClass} value={note.projection} onChange={event => updateVoiceNote(span.id, { projection: event.target.value as DirectionVoiceNoteV2["projection"] })}>{directionProjectionSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                  <select className={inputClass} value={note.vocalState} onChange={event => updateVoiceNote(span.id, { vocalState: event.target.value as DirectionVoiceNoteV2["vocalState"] })}>{directionVocalStateSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                  <label className="text-[9px] text-white/25">Intensidad {Math.round(note.intensity * 100)}%<input className="mt-2 w-full" type="range" min={0} max={1} step={0.05} value={note.intensity} onChange={event => updateVoiceNote(span.id, { intensity: Number(event.target.value) })} /></label>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/[.07] bg-white/[.018] p-3.5 sm:p-4">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4" style={{ color: accent }} />
          <div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-white/70">Música instrumental</h3><p className="text-[10px] text-white/25">Regiones, silencios, intensidad y fonoteca</p></div>
          <button type="button" onClick={addMusicRegion} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[10px]" style={{ color: accent, background: `${accent}12` }}><Plus className="h-3.5 w-3.5" />Región</button>
        </div>

        <div className="space-y-2">
          {project.musicProject.regions.length === 0 && <p className="rounded-xl border border-dashed border-white/[.07] p-4 text-center text-[10px] text-white/25">Sin regiones: el capítulo conservará silencio musical.</p>}
          {project.musicProject.regions.map(region => {
            const node = project.musicNodes.find(candidate => candidate.regionId === region.id) ?? defaultMusicNode(region)
            return (
              <div key={region.id} className="space-y-2 rounded-xl border border-white/[.06] bg-black/20 p-3">
                <div className="flex items-center gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={region.name} onChange={event => updateRegion(region.id, { name: event.target.value })} /><button type="button" onClick={() => updateMusicNode(region.id, { locked: !node.locked })} className="p-2 text-white/30" aria-label="Proteger región">{node.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button><button type="button" onClick={() => removeRegion(region.id)} className="p-2 text-red-200/35" aria-label="Eliminar región"><Trash2 className="h-3.5 w-3.5" /></button></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="text-[9px] text-white/25">Inicio<input className={`${inputClass} mt-1`} type="number" min={0} max={paragraphs.length - 1} value={region.startParagraph} onChange={event => updateRegion(region.id, { startParagraph: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Final<input className={`${inputClass} mt-1`} type="number" min={0} max={paragraphs.length - 1} value={region.endParagraph} onChange={event => updateRegion(region.id, { endParagraph: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Intención<select className={`${inputClass} mt-1`} value={region.mood} onChange={event => updateRegion(region.id, { mood: event.target.value as NarrativeMood })}>{MOODS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label className="text-[9px] text-white/25">Partitura<select className={`${inputClass} mt-1`} disabled={region.mood === "silence"} value={region.scoreId ?? ""} onChange={event => updateRegion(region.id, { scoreId: event.target.value ? Number(event.target.value) : null })}><option value="">Music Brain procedural</option>{scores.map(score => <option key={score.id} value={score.id}>{score.title} · {score.bpm} BPM</option>)}</select></label>
                  <label className="text-[9px] text-white/25">Intensidad {Math.round(region.targetIntensity * 100)}%<input className="mt-2 w-full" type="range" min={0} max={0.8} step={0.05} value={region.targetIntensity} onChange={event => updateRegion(region.id, { targetIntensity: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Tensión {Math.round(region.tension * 100)}%<input className="mt-2 w-full" type="range" min={0} max={1} step={0.05} value={region.tension} onChange={event => updateRegion(region.id, { tension: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Calidez {Math.round(region.warmth * 100)}%<input className="mt-2 w-full" type="range" min={0} max={1} step={0.05} value={region.warmth} onChange={event => updateRegion(region.id, { warmth: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Densidad {Math.round(region.density * 100)}%<input className="mt-2 w-full" type="range" min={0} max={1} step={0.05} value={region.density} onChange={event => updateRegion(region.id, { density: Number(event.target.value) })} /></label>
                  <label className="text-[9px] text-white/25">Crossfade<input className={`${inputClass} mt-1`} type="number" min={0.25} max={30} step={0.25} value={node.crossfadeSeconds} onChange={event => updateMusicNode(region.id, { crossfadeSeconds: Number(event.target.value) })} /></label>
                  <label className="col-span-2 text-[9px] text-white/25 sm:col-span-3">Nota de intención<input className={`${inputClass} mt-1`} value={node.note} onChange={event => updateMusicNode(region.id, { note: event.target.value })} placeholder="Qué debe preservar el DA en futuros análisis" /></label>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div className="sticky bottom-3 z-20 rounded-2xl border border-white/[.08] bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] ${dirty ? "text-amber-200/55" : "text-emerald-200/45"}`}>{dirty ? "Cambios sin guardar" : "Partitura sincronizada"}</span>
          <span className="flex-1" />
          <button type="button" disabled={!!busy || currentRevision === 0 || dirty} onClick={compileProjects} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-white/[.08] px-3 text-[10px] text-white/45 disabled:opacity-30"><Check className="h-3.5 w-3.5" />Preparar</button>
          <button type="button" disabled={!!busy || currentRevision === 0 || dirty} onClick={publishProjects} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-white/[.08] px-3 text-[10px] text-white/45 disabled:opacity-30"><UploadCloud className="h-3.5 w-3.5" />Publicar</button>
          <button type="button" disabled={!!busy || !dirty} onClick={saveProject} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 text-[11px] font-semibold disabled:opacity-35" style={{ color: "#050505", background: accent }}>{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Guardar</button>
        </div>
        {notice && <p role="status" className="mt-2 rounded-lg bg-white/[.025] px-2.5 py-2 text-[10px] leading-relaxed text-white/45">{notice}</p>}
      </div>
    </section>
  )
}
