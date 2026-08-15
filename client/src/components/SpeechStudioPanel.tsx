import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, EyeOff, Loader2, Plus, Sparkles, UserRound, UsersRound } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"
import { apiRequest } from "@/lib/queryClient"
import { narrativeParagraphsFor } from "@shared/narrative"
import {
  speechDeliverySchema,
  type SpeechCharacterV1,
  type SpeechDelivery,
  type SpeechProjectV1,
  type SpeechSpanV1,
} from "@shared/speech"
import { speechUi } from "@shared/speech-i18n"

interface VoiceOption {
  id: number
  label: string
  description: string
  language: string
  role: "narrator" | "dialogue" | "both"
  license: string
}

interface SpeechResponse {
  contentHash: string
  project: SpeechProjectV1 | null
  stale: boolean
  profileStatus: "draft" | "approved" | null
  oracle: { eligible: boolean; configured: boolean; paperBalance: number }
}

type Busy = "load" | "oracle" | "save" | "compile" | "publish" | null

function emptyProject(bookId: number, chapterIndex: number, contentHash: string): SpeechProjectV1 {
  return {
    version: 1,
    bookId,
    chapterIndex,
    revision: 1,
    contentHash,
    language: "es",
    narratorVoiceProfileId: null,
    paragraphPauseMs: 650,
    characters: [],
    spans: [],
  }
}

function messageFor(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const jsonStart = error.message.indexOf("{")
  if (jsonStart >= 0) {
    try { return JSON.parse(error.message.slice(jsonStart))?.message || fallback } catch { /* fallback */ }
  }
  return error.message || fallback
}

export default function SpeechStudioPanel({
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
  const { settings } = useSettings()
  const copy = speechUi(settings.language)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Busy>("load")
  const [project, setProject] = useState(() => emptyProject(bookId, chapterIndex, "0".repeat(64)))
  const [proposal, setProposal] = useState<SpeechProjectV1 | null>(null)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [storedRevision, setStoredRevision] = useState(0)
  const [profileStatus, setProfileStatus] = useState<"draft" | "approved" | null>(null)
  const [estimatedPaper, setEstimatedPaper] = useState<number | null>(null)
  const [oracle, setOracle] = useState({ eligible: false, configured: false, paperBalance: 0 })
  const [serverStale, setServerStale] = useState(false)
  const [loadedContent, setLoadedContent] = useState(content)
  const [notice, setNotice] = useState("")

  const paragraphs = useMemo(() => narrativeParagraphsFor(content), [content])
  const manuscriptIsStale = serverStale || loadedContent !== content
  const narratorVoices = voices.filter(voice => voice.role !== "dialogue")
  const dialogueVoices = voices.filter(voice => voice.role !== "narrator")

  useEffect(() => {
    let cancelled = false
    setBusy("load")
    Promise.all([
      fetch(`/api/books/${bookId}/speech/${chapterIndex}`, { credentials: "include" }),
      fetch("/api/voices", { credentials: "include" }),
    ]).then(async ([speechResponse, voiceResponse]) => {
      if (!speechResponse.ok) throw new Error(await speechResponse.text())
      const speech = await speechResponse.json() as SpeechResponse
      const voiceData = voiceResponse.ok ? await voiceResponse.json() as { voices: VoiceOption[] } : { voices: [] }
      if (cancelled) return
      setProject(speech.project ?? emptyProject(bookId, chapterIndex, speech.contentHash))
      setStoredRevision(speech.project?.revision ?? 0)
      setProfileStatus(speech.profileStatus)
      setOracle(speech.oracle)
      setServerStale(speech.stale)
      setLoadedContent(content)
      setVoices(voiceData.voices)
      setNotice("")
    }).catch(error => !cancelled && setNotice(messageFor(error, copy.error)))
      .finally(() => !cancelled && setBusy(null))
    return () => { cancelled = true }
  }, [bookId, chapterIndex, copy.error])

  function updateCharacter(id: string, patch: Partial<SpeechCharacterV1>) {
    setProject(current => ({
      ...current,
      characters: current.characters.map(character => character.id === id ? { ...character, ...patch } : character),
    }))
  }

  function updateSpan(id: string, patch: Partial<SpeechSpanV1>) {
    setProject(current => ({
      ...current,
      spans: current.spans.map(span => span.id === id ? { ...span, ...patch } : span),
    }))
  }

  function addCharacter() {
    const index = project.characters.length + 1
    const character: SpeechCharacterV1 = {
      id: `personaje_${Date.now()}`,
      name: `${copy.characters} ${index}`,
      aliases: [],
      voiceProfileId: null,
      confidence: 1,
      source: "manual",
      locked: false,
    }
    setProject(current => ({ ...current, characters: [...current.characters, character] }))
  }

  function createBaseDirection() {
    const spans = paragraphs.map<SpeechSpanV1>((paragraph, index) => ({
      id: `narration_${index + 1}`,
      paragraphIndex: index,
      startOffset: 0,
      endOffset: paragraph.length,
      kind: "narration",
      speakerId: "narrator",
      delivery: "neutral",
      pace: 1,
      pauseBeforeMs: 0,
      pauseAfterMs: index === paragraphs.length - 1 ? 0 : 350,
      confidence: 1,
      source: "manual",
      locked: false,
      note: "",
    })).filter(span => span.endOffset > 0)
    setProject(current => ({ ...current, spans }))
  }

  async function runOracle() {
    setBusy("oracle")
    setNotice("")
    try {
      const response = await apiRequest("POST", `/api/books/${bookId}/speech/${chapterIndex}/oracle`, { requestKey: crypto.randomUUID() })
      const data = await response.json() as { project: SpeechProjectV1; paperCharged: number }
      setProposal(data.project)
      setOracle(current => ({ ...current, paperBalance: Math.max(0, current.paperBalance - data.paperCharged) }))
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  function acceptProposal() {
    if (!proposal) return
    const oldVoices = new Map(project.characters.map(character => [character.id, character.voiceProfileId]))
    setProject({
      ...proposal,
      narratorVoiceProfileId: project.narratorVoiceProfileId,
      characters: proposal.characters.map(character => ({
        ...character,
        voiceProfileId: oldVoices.get(character.id) ?? null,
      })),
    })
    setProposal(null)
    setNotice("")
  }

  async function saveProject() {
    setBusy("save")
    setNotice("")
    try {
      const { bookId: _bookId, chapterIndex: _chapter, revision: _revision, contentHash: _hash, ...editable } = project
      const response = await apiRequest("PUT", `/api/books/${bookId}/speech/${chapterIndex}`, {
        expectedRevision: storedRevision,
        project: editable,
      })
      const data = await response.json() as { project: SpeechProjectV1 }
      setProject(data.project)
      setStoredRevision(data.project.revision)
      setLoadedContent(content)
      setServerStale(false)
      setProfileStatus(null)
      setEstimatedPaper(null)
      setNotice(copy.saved)
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  async function compile() {
    setBusy("compile")
    setNotice("")
    try {
      const response = await apiRequest("POST", `/api/books/${bookId}/speech/${chapterIndex}/compile`)
      const data = await response.json() as { estimatedPaper: number }
      setEstimatedPaper(data.estimatedPaper)
      setProfileStatus("draft")
      setNotice(copy.compiled)
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    setBusy("publish")
    setNotice("")
    try {
      await apiRequest("POST", `/api/books/${bookId}/speech/${chapterIndex}/publish`)
      setProfileStatus("approved")
      setNotice(copy.published)
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  const oracleReason = !oracle.eligible ? copy.subscription
    : !oracle.configured ? copy.unavailable
      : manuscriptIsStale ? copy.stale
        : ""

  return (
    <section className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)" }}>
      <button type="button" onClick={() => setOpen(value => !value)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="grid place-items-center w-8 h-8 rounded-xl" style={{ background: `${accent}16`, color: accent }}><UsersRound className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-zinc-200 font-sans font-semibold">{copy.title}</span>
          <span className="block text-[10px] text-zinc-600 font-sans truncate">{copy.subtitle}</span>
        </span>
        <span className="text-[9px] text-zinc-600 font-sans hidden sm:block">{project.spans.length} {copy.fragments}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="pt-3 flex flex-wrap gap-2 items-center">
            <button type="button" disabled={!!busy || !!oracleReason} title={oracleReason} onClick={runOracle} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-sans font-semibold disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: `${accent}18`, border: `1px solid ${accent}42`, color: accent }}>
              {busy === "oracle" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {busy === "oracle" ? copy.analyzing : copy.oracle}
            </button>
            <span className="text-[9px] text-zinc-600 font-sans">{copy.paper}: {oracle.paperBalance}</span>
            <span className="inline-flex items-center gap-1 text-[9px] text-zinc-700 font-sans"><EyeOff className="w-3 h-3" />{copy.hidden}</span>
          </div>
          {oracleReason && <p className="text-[10px] text-zinc-600 font-sans">{oracleReason}</p>}

          {proposal && (
            <div className="rounded-xl p-3" style={{ background: `${accent}0d`, border: `1px solid ${accent}2f` }}>
              <p className="text-[11px] text-zinc-300 font-sans font-semibold">{copy.proposal} · {proposal.characters.length} {copy.characters.toLowerCase()} · {proposal.spans.length} {copy.fragments}</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={acceptProposal} className="px-3 py-1.5 rounded-lg text-[10px] font-sans" style={{ background: accent, color: "#080808" }}>{copy.accept}</button>
                <button type="button" onClick={() => setProposal(null)} className="px-3 py-1.5 rounded-lg text-[10px] text-zinc-500 font-sans" style={{ background: "rgba(255,255,255,0.05)" }}>{copy.discard}</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="rounded-xl p-3 text-[10px] text-zinc-500 font-sans" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="flex items-center gap-1.5 mb-2 text-zinc-300"><UserRound className="w-3.5 h-3.5" />{copy.narrator}</span>
              <select value={project.narratorVoiceProfileId ?? ""} onChange={event => setProject(current => ({ ...current, narratorVoiceProfileId: event.target.value ? Number(event.target.value) : null }))} className="w-full rounded-lg p-2 bg-black/40 text-zinc-300 outline-none">
                <option value="">{copy.chooseVoice}</option>
                {narratorVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label} · {voice.language.toUpperCase()}</option>)}
              </select>
            </label>
            <label className="rounded-xl p-3 text-[10px] text-zinc-500 font-sans" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {copy.pauseAfter} · {copy.narrator}
              <input type="number" min={0} max={5000} value={project.paragraphPauseMs} onChange={event => setProject(current => ({ ...current, paragraphPauseMs: Number(event.target.value) }))} className="mt-2 w-full rounded-lg p-2 bg-black/40 text-zinc-300 outline-none" />
            </label>
          </div>

          <div className="space-y-2">
            {project.characters.map(character => (
              <div key={character.id} className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <input value={character.name} onChange={event => updateCharacter(character.id, { name: event.target.value })} className="bg-transparent outline-none text-[11px] text-zinc-300 font-sans font-semibold" />
                <select value={character.voiceProfileId ?? ""} onChange={event => updateCharacter(character.id, { voiceProfileId: event.target.value ? Number(event.target.value) : null })} className="rounded-lg p-2 bg-black/40 text-[10px] text-zinc-400 outline-none">
                  <option value="">{copy.chooseVoice}</option>
                  {dialogueVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.label} · {voice.language.toUpperCase()}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addCharacter} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-500 font-sans" style={{ background: "rgba(255,255,255,0.04)" }}><Plus className="w-3 h-3" />{copy.addCharacter}</button>
            {project.spans.length === 0 && <button type="button" onClick={createBaseDirection} className="px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-500 font-sans" style={{ background: "rgba(255,255,255,0.04)" }}>{copy.base}</button>}
          </div>

          <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
            {project.spans.length === 0 && <p className="py-3 text-center text-[10px] text-zinc-700 font-sans">{copy.noFragments}</p>}
            {project.spans.map(span => {
              const text = paragraphs[span.paragraphIndex]?.slice(span.startOffset, span.endOffset) || ""
              return (
                <div key={span.id} className="rounded-xl p-3 space-y-2" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[11px] leading-relaxed text-zinc-400 font-serif">{text}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="text-[9px] text-zinc-600 font-sans">{copy.speaker}<select value={span.speakerId} onChange={event => updateSpan(span.id, { speakerId: event.target.value, kind: event.target.value === "narrator" ? "narration" : "dialogue" })} className="block mt-1 w-full rounded-md p-1.5 bg-black/40 text-zinc-400 outline-none"><option value="narrator">{copy.narrator}</option>{project.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
                    <label className="text-[9px] text-zinc-600 font-sans">{copy.delivery}<select value={span.delivery} onChange={event => updateSpan(span.id, { delivery: event.target.value as SpeechDelivery })} className="block mt-1 w-full rounded-md p-1.5 bg-black/40 text-zinc-400 outline-none">{speechDeliverySchema.options.map(delivery => <option key={delivery} value={delivery}>{delivery}</option>)}</select></label>
                    <label className="text-[9px] text-zinc-600 font-sans">{copy.pauseBefore}<input type="number" min={0} max={5000} value={span.pauseBeforeMs} onChange={event => updateSpan(span.id, { pauseBeforeMs: Number(event.target.value) })} className="block mt-1 w-full rounded-md p-1.5 bg-black/40 text-zinc-400 outline-none" /></label>
                    <label className="text-[9px] text-zinc-600 font-sans">{copy.pauseAfter}<input type="number" min={0} max={5000} value={span.pauseAfterMs} onChange={event => updateSpan(span.id, { pauseAfterMs: Number(event.target.value) })} className="block mt-1 w-full rounded-md p-1.5 bg-black/40 text-zinc-400 outline-none" /></label>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {estimatedPaper !== null && <span className="text-[9px] text-zinc-600 font-sans">{copy.estimated}: {estimatedPaper} {copy.paper}</span>}
            <span className="flex-1" />
            <button type="button" onClick={saveProject} disabled={!!busy || manuscriptIsStale} className="px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-400 font-sans disabled:opacity-40" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>{copy.save}</button>
            <button type="button" onClick={compile} disabled={!!busy || storedRevision === 0 || manuscriptIsStale} className="px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-400 font-sans disabled:opacity-40" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>{copy.compile}</button>
            <button type="button" onClick={publish} disabled={!!busy || profileStatus !== "draft"} className="px-2.5 py-1.5 rounded-lg text-[10px] font-sans disabled:opacity-40" style={{ background: profileStatus === "approved" ? "rgba(52,211,153,0.12)" : `${accent}18`, color: profileStatus === "approved" ? "#6ee7b7" : accent }}>{copy.publish}</button>
          </div>
          {notice && <p role="status" className="text-[10px] text-zinc-500 font-sans">{notice}</p>}
        </div>
      )}
    </section>
  )
}
