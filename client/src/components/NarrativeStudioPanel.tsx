import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, EyeOff, Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"
import { apiRequest } from "@/lib/queryClient"
import {
  paragraphCountFor,
  type NarrativeMood,
  type NarrativeProjectV1,
  type NarrativeRegionV1,
} from "@shared/narrative"
import { narrativeUi } from "@shared/narrative-i18n"

interface NarrativeResponse {
  paragraphCount: number
  project: NarrativeProjectV1 | null
  profileStatus: "draft" | "approved" | null
  oracle: { eligible: boolean; configured: boolean; paperBalance: number }
}

const MOODS: NarrativeMood[] = [
  "neutral", "calm", "wonder", "melancholy", "rising_tension",
  "confrontation", "climax", "release", "silence",
]

function emptyProject(bookId: number, chapterIndex: number): NarrativeProjectV1 {
  return {
    version: 1,
    bookId,
    chapterIndex,
    revision: 1,
    directionStyle: "subtle",
    defaultScoreId: null,
    regions: [],
  }
}

function manualRegion(index: number, start: number, end: number): NarrativeRegionV1 {
  return {
    id: `manual-${Date.now()}-${index}`,
    name: `Región ${index + 1}`,
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

function messageFor(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const jsonStart = error.message.indexOf("{")
  if (jsonStart >= 0) {
    try { return JSON.parse(error.message.slice(jsonStart))?.message || fallback } catch { /* use fallback */ }
  }
  return error.message || fallback
}

export default function NarrativeStudioPanel({
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
  const copy = narrativeUi(settings.language)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<"load" | "oracle" | "save" | "compile" | "publish" | null>("load")
  const [project, setProject] = useState<NarrativeProjectV1>(() => emptyProject(bookId, chapterIndex))
  const [proposal, setProposal] = useState<NarrativeProjectV1 | null>(null)
  const [storedRevision, setStoredRevision] = useState(0)
  const [serverParagraphs, setServerParagraphs] = useState(1)
  const [profileStatus, setProfileStatus] = useState<"draft" | "approved" | null>(null)
  const [oracle, setOracle] = useState({ eligible: false, configured: false, paperBalance: 0 })
  const [notice, setNotice] = useState("")

  const localParagraphs = useMemo(() => paragraphCountFor(content), [content])
  const manuscriptIsStale = serverParagraphs !== localParagraphs

  useEffect(() => {
    let cancelled = false
    setBusy("load")
    fetch(`/api/books/${bookId}/narrative/${chapterIndex}`, { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error(await response.text())
        return response.json() as Promise<NarrativeResponse>
      })
      .then(data => {
        if (cancelled) return
        const next = data.project ?? emptyProject(bookId, chapterIndex)
        setProject(next)
        setStoredRevision(data.project?.revision ?? 0)
        setServerParagraphs(data.paragraphCount)
        setProfileStatus(data.profileStatus)
        setOracle(data.oracle)
        setNotice("")
      })
      .catch(error => !cancelled && setNotice(messageFor(error, copy.error)))
      .finally(() => !cancelled && setBusy(null))
    return () => { cancelled = true }
  }, [bookId, chapterIndex, copy.error])

  function updateRegion(id: string, patch: Partial<NarrativeRegionV1>) {
    setProject(current => ({
      ...current,
      regions: current.regions.map(region => region.id === id ? { ...region, ...patch } : region),
    }))
  }

  function addRegion() {
    const lastEnd = project.regions.reduce((max, region) => Math.max(max, region.endParagraph), -1)
    const start = lastEnd + 1
    if (start >= localParagraphs) return
    const end = Math.min(localParagraphs - 1, start + 2)
    setProject(current => ({
      ...current,
      regions: [...current.regions, manualRegion(current.regions.length, start, end)],
    }))
  }

  async function runOracle() {
    setBusy("oracle")
    setNotice("")
    try {
      const response = await apiRequest("POST", `/api/books/${bookId}/narrative/${chapterIndex}/oracle`, {
        requestKey: crypto.randomUUID(),
      })
      const data = await response.json() as { project: NarrativeProjectV1; paperCharged: number }
      setProposal(data.project)
      setOracle(current => ({ ...current, paperBalance: Math.max(0, current.paperBalance - data.paperCharged) }))
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  async function saveProject() {
    setBusy("save")
    setNotice("")
    try {
      const { bookId: _bookId, chapterIndex: _chapter, revision: _revision, ...editable } = project
      const response = await apiRequest("PUT", `/api/books/${bookId}/narrative/${chapterIndex}`, {
        expectedRevision: storedRevision,
        project: editable,
      })
      const data = await response.json() as { project: NarrativeProjectV1 }
      setProject(data.project)
      setStoredRevision(data.project.revision)
      setServerParagraphs(localParagraphs)
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
      await apiRequest("POST", `/api/books/${bookId}/narrative/${chapterIndex}/compile`)
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
      await apiRequest("POST", `/api/books/${bookId}/narrative/${chapterIndex}/publish`)
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
  const oracleDisabled = !!busy || !!oracleReason

  return (
    <section className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)" }}>
      <button type="button" onClick={() => setOpen(value => !value)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="grid place-items-center w-8 h-8 rounded-xl" style={{ background: `${accent}16`, color: accent }}><EyeOff className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-zinc-200 font-sans font-semibold">{copy.title}</span>
          <span className="block text-[10px] text-zinc-600 font-sans truncate">{copy.subtitle}</span>
        </span>
        <span className="text-[9px] text-zinc-600 font-sans hidden sm:block">{project.regions.length} {copy.regions}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="pt-3 flex flex-wrap gap-2 items-center">
            <button
              type="button"
              disabled={oracleDisabled}
              title={oracleReason}
              onClick={runOracle}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-sans font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: `${accent}18`, border: `1px solid ${accent}42`, color: accent }}
            >
              {busy === "oracle" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {busy === "oracle" ? copy.analyzing : copy.oracle}
            </button>
            <span className="text-[9px] text-zinc-600 font-sans">{copy.paper}: {oracle.paperBalance}</span>
            <span className="inline-flex items-center gap-1 text-[9px] text-zinc-700 font-sans"><EyeOff className="w-3 h-3" />{copy.hidden}</span>
          </div>
          {oracleReason && <p className="text-[10px] text-zinc-600 font-sans">{oracleReason}</p>}

          {proposal && (
            <div className="rounded-xl p-3" style={{ background: `${accent}0d`, border: `1px solid ${accent}2f` }}>
              <p className="text-[11px] text-zinc-300 font-sans font-semibold">{copy.proposal} · {proposal.regions.length} {copy.regions}</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => { setProject(proposal); setProposal(null); setNotice("") }} className="px-3 py-1.5 rounded-lg text-[10px] font-sans" style={{ background: accent, color: "#080808" }}>{copy.accept}</button>
                <button type="button" onClick={() => setProposal(null)} className="px-3 py-1.5 rounded-lg text-[10px] text-zinc-500 font-sans" style={{ background: "rgba(255,255,255,0.05)" }}>{copy.discard}</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {project.regions.length === 0 && <p className="py-3 text-center text-[10px] text-zinc-700 font-sans">{copy.noRegions}</p>}
            {project.regions.map(region => (
              <div key={region.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 rounded-xl p-3" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="min-w-0">
                  <input value={region.name} onChange={event => updateRegion(region.id, { name: event.target.value })} className="w-full bg-transparent outline-none text-[11px] text-zinc-300 font-sans font-semibold" />
                  <select value={region.mood} onChange={event => updateRegion(region.id, { mood: event.target.value as NarrativeMood })} className="mt-1 bg-transparent text-[9px] text-zinc-600 font-sans outline-none">
                    {MOODS.map(mood => <option key={mood} value={mood}>{mood}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-sans">
                  {copy.paragraph}
                  <input type="number" min={0} max={localParagraphs - 1} value={region.startParagraph} onChange={event => {
                    const startParagraph = Number(event.target.value)
                    updateRegion(region.id, { startParagraph, preferredParagraph: Math.max(startParagraph, Math.min(region.preferredParagraph, region.endParagraph)) })
                  }} className="w-12 rounded-md px-1 py-1 bg-black/30 text-zinc-400 outline-none" />
                  –
                  <input type="number" min={0} max={localParagraphs - 1} value={region.endParagraph} onChange={event => {
                    const endParagraph = Number(event.target.value)
                    updateRegion(region.id, { endParagraph, preferredParagraph: Math.min(endParagraph, Math.max(region.preferredParagraph, region.startParagraph)) })
                  }} className="w-12 rounded-md px-1 py-1 bg-black/30 text-zinc-400 outline-none" />
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] text-zinc-600 font-sans">{copy.intensity}<input type="range" min="0" max="0.8" step="0.05" value={region.targetIntensity} onChange={event => updateRegion(region.id, { targetIntensity: Number(event.target.value) })} className="block w-24 accent-current" /></label>
                  <button type="button" title={copy.remove} onClick={() => setProject(current => ({ ...current, regions: current.regions.filter(item => item.id !== region.id) }))} className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addRegion} disabled={project.regions.some(region => region.endParagraph >= localParagraphs - 1)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-500 font-sans disabled:opacity-30" style={{ background: "rgba(255,255,255,0.04)" }}><Plus className="w-3 h-3" />{copy.addRegion}</button>
            <span className="flex-1" />
            <button type="button" onClick={saveProject} disabled={!!busy} className="px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-400 font-sans disabled:opacity-40" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>{copy.save}</button>
            <button type="button" onClick={compile} disabled={!!busy || storedRevision === 0} className="px-2.5 py-1.5 rounded-lg text-[10px] text-zinc-400 font-sans disabled:opacity-40" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>{copy.compile}</button>
            <button type="button" onClick={publish} disabled={!!busy || profileStatus !== "draft"} className="px-2.5 py-1.5 rounded-lg text-[10px] font-sans disabled:opacity-40" style={{ background: profileStatus === "approved" ? "rgba(52,211,153,0.12)" : `${accent}18`, color: profileStatus === "approved" ? "#6ee7b7" : accent }}>{copy.publish}</button>
          </div>
          {notice && <p role="status" className="text-[10px] text-zinc-500 font-sans">{notice}</p>}
        </div>
      )}
    </section>
  )
}
