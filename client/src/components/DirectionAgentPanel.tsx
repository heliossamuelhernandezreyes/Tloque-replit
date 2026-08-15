import { useEffect, useMemo, useState } from "react"
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileLock2, Loader2, Lock, Music2, Sparkles, Unlock, Volume2 } from "lucide-react"
import { apiRequest } from "@/lib/queryClient"
import { useSettings } from "@/context/SettingsContext"
import { narrativeParagraphsFor } from "@shared/narrative"
import {
  directionEmotionSchema,
  directionProjectionSchema,
  directionVocalStateSchema,
  type AdvancedDirectionProjectV2,
  type DirectionAgentMode,
  type DirectionVoiceNoteV2,
} from "@shared/direction"

type Busy = "load" | "quote" | "run" | "save" | null

interface DirectionResponse {
  contentHash: string
  project: AdvancedDirectionProjectV2 | null
  stale: boolean
  agent: { configured: boolean; paperBalance: number; promptVersion: string }
}

interface QuoteResponse {
  requestKey: string
  estimatedPaper: number
  maximumPaper: number
  paperBalance: number
  expiresAt: string
}

const ui = {
  es: { title: "Director Artificial", subtitle: "Prepara actuación, pausas y nodos musicales sin tocar el manuscrito", hidden: "Capa invisible para el lector", quote: "Calcular uso de Papel", run: "Crear propuesta", replace: "Reemplazar lo no bloqueado", gaps: "Sólo completar huecos", estimated: "Estimado", maximum: "Reserva máxima", balance: "Saldo", review: "Revisar propuesta", apply: "Aplicar a la partitura", applied: "Partitura avanzada actualizada", voice: "Actuación y voces", music: "Música del catálogo", cues: "indicaciones", locked: "Bloqueado", noMusic: "Sin nodos musicales", stale: "El texto cambió. Guarda el capítulo antes de analizar.", unavailable: "Configura Oráculo/Groq para activar el DA", safety: "No crea audio ni música; sólo propone metadatos.", error: "No se pudo completar la acción", analyzing: "El DA está leyendo la obra y componiendo la partitura…" },
  en: { title: "Artificial Director", subtitle: "Prepares performance, pauses and music nodes without touching the manuscript", hidden: "Invisible reader layer", quote: "Calculate Paper use", run: "Create proposal", replace: "Replace unlocked cues", gaps: "Fill gaps only", estimated: "Estimated", maximum: "Maximum reserve", balance: "Balance", review: "Review proposal", apply: "Apply to score", applied: "Advanced score updated", voice: "Performance and voices", music: "Catalog music", cues: "cues", locked: "Locked", noMusic: "No music nodes", stale: "The text changed. Save the chapter before analysis.", unavailable: "Configure Oracle/Groq to enable the AD", safety: "It creates no audio or music; it only proposes metadata.", error: "The action could not be completed", analyzing: "The AD is reading the work and composing its score…" },
  pt: { title: "Diretor Artificial", subtitle: "Prepara atuação, pausas e nós musicais sem alterar o manuscrito", hidden: "Camada invisível ao leitor", quote: "Calcular uso de Papel", run: "Criar proposta", replace: "Substituir o que não está bloqueado", gaps: "Apenas preencher lacunas", estimated: "Estimado", maximum: "Reserva máxima", balance: "Saldo", review: "Revisar proposta", apply: "Aplicar à partitura", applied: "Partitura avançada atualizada", voice: "Atuação e vozes", music: "Música do catálogo", cues: "indicações", locked: "Bloqueado", noMusic: "Sem nós musicais", stale: "O texto mudou. Salve o capítulo antes da análise.", unavailable: "Configure Oráculo/Groq para ativar o DA", safety: "Não cria áudio nem música; apenas propõe metadados.", error: "Não foi possível concluir a ação", analyzing: "O DA está lendo a obra e compondo a partitura…" },
  fr: { title: "Directeur artificiel", subtitle: "Prépare jeu, pauses et nœuds musicaux sans modifier le manuscrit", hidden: "Couche invisible au lecteur", quote: "Calculer l’usage du Papier", run: "Créer la proposition", replace: "Remplacer les éléments non verrouillés", gaps: "Compléter seulement les vides", estimated: "Estimé", maximum: "Réserve maximale", balance: "Solde", review: "Réviser la proposition", apply: "Appliquer à la partition", applied: "Partition avancée mise à jour", voice: "Jeu et voix", music: "Musique du catalogue", cues: "indications", locked: "Verrouillé", noMusic: "Aucun nœud musical", stale: "Le texte a changé. Enregistrez le chapitre avant l’analyse.", unavailable: "Configurez Oracle/Groq pour activer le DA", safety: "Il ne crée ni audio ni musique ; seulement des métadonnées.", error: "Action impossible", analyzing: "Le DA lit l’œuvre et compose sa partition…" },
  de: { title: "Künstliche Regie", subtitle: "Bereitet Spiel, Pausen und Musikknoten vor, ohne das Manuskript zu ändern", hidden: "Für Leser unsichtbare Ebene", quote: "Papierverbrauch berechnen", run: "Vorschlag erstellen", replace: "Nicht gesperrte Hinweise ersetzen", gaps: "Nur Lücken füllen", estimated: "Geschätzt", maximum: "Maximale Reserve", balance: "Guthaben", review: "Vorschlag prüfen", apply: "Auf Partitur anwenden", applied: "Erweiterte Partitur aktualisiert", voice: "Spiel und Stimmen", music: "Katalogmusik", cues: "Hinweise", locked: "Gesperrt", noMusic: "Keine Musikknoten", stale: "Der Text wurde geändert. Kapitel vor der Analyse speichern.", unavailable: "Oracle/Groq konfigurieren, um die Regie zu aktivieren", safety: "Erzeugt weder Audio noch Musik, nur Metadaten.", error: "Aktion fehlgeschlagen", analyzing: "Die Regie liest das Werk und komponiert die Partitur…" },
  it: { title: "Direttore Artificiale", subtitle: "Prepara recitazione, pause e nodi musicali senza modificare il manoscritto", hidden: "Livello invisibile al lettore", quote: "Calcola uso della Carta", run: "Crea proposta", replace: "Sostituisci ciò che non è bloccato", gaps: "Completa solo i vuoti", estimated: "Stimato", maximum: "Riserva massima", balance: "Saldo", review: "Rivedi proposta", apply: "Applica alla partitura", applied: "Partitura avanzata aggiornata", voice: "Recitazione e voci", music: "Musica del catalogo", cues: "indicazioni", locked: "Bloccato", noMusic: "Nessun nodo musicale", stale: "Il testo è cambiato. Salva il capitolo prima dell’analisi.", unavailable: "Configura Oracolo/Groq per attivare il DA", safety: "Non crea audio o musica; propone solo metadati.", error: "Impossibile completare l’azione", analyzing: "Il DA sta leggendo l’opera e componendo la partitura…" },
  ja: { title: "AIディレクター", subtitle: "原稿を変更せず、演技・間・音楽ノードを準備します", hidden: "読者には見えないレイヤー", quote: "紙の使用量を計算", run: "提案を作成", replace: "未ロックの指示を置換", gaps: "空白のみ補完", estimated: "見積り", maximum: "最大予約", balance: "残高", review: "提案を確認", apply: "演出譜に反映", applied: "高度な演出譜を更新しました", voice: "演技と声", music: "カタログ音楽", cues: "指示", locked: "ロック済み", noMusic: "音楽ノードなし", stale: "本文が変更されました。分析前に章を保存してください。", unavailable: "Oracle/Groq を設定して有効化してください", safety: "音声や音楽は生成せず、メタデータのみ提案します。", error: "操作を完了できませんでした", analyzing: "作品を読み、演出譜を構成しています…" },
  zh: { title: "人工导演", subtitle: "在不修改正文的前提下准备表演、停顿和音乐节点", hidden: "读者不可见的图层", quote: "计算纸张用量", run: "创建提案", replace: "替换未锁定标注", gaps: "仅补充空缺", estimated: "预计", maximum: "最大预留", balance: "余额", review: "审阅提案", apply: "应用到编排", applied: "高级编排已更新", voice: "表演与声音", music: "目录音乐", cues: "条标注", locked: "已锁定", noMusic: "无音乐节点", stale: "文本已更改。请先保存章节。", unavailable: "配置 Oracle/Groq 后启用", safety: "不会生成音频或音乐，只提出元数据。", error: "无法完成操作", analyzing: "正在阅读作品并编排…" },
  ar: { title: "المخرج الاصطناعي", subtitle: "يُعدّ الأداء والوقفات والعُقد الموسيقية دون تغيير المخطوطة", hidden: "طبقة غير مرئية للقارئ", quote: "حساب استهلاك الورق", run: "إنشاء اقتراح", replace: "استبدال غير المقفل", gaps: "ملء الفراغات فقط", estimated: "المقدّر", maximum: "الحد الأقصى للحجز", balance: "الرصيد", review: "مراجعة الاقتراح", apply: "تطبيق على النوتة", applied: "تم تحديث النوتة المتقدمة", voice: "الأداء والأصوات", music: "موسيقى الفهرس", cues: "تعليمات", locked: "مقفل", noMusic: "لا توجد عقد موسيقية", stale: "تغير النص. احفظ الفصل قبل التحليل.", unavailable: "اضبط Oracle/Groq لتفعيل المخرج", safety: "لا ينشئ صوتاً أو موسيقى؛ يقترح بيانات وصفية فقط.", error: "تعذر إكمال العملية", analyzing: "يقرأ العمل ويؤلف النوتة…" },
} as const

function messageFor(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const jsonStart = error.message.indexOf("{")
  if (jsonStart >= 0) {
    try { return JSON.parse(error.message.slice(jsonStart))?.message || fallback } catch { /* fallback */ }
  }
  return error.message || fallback
}

export default function DirectionAgentPanel({
  bookId,
  chapterIndex,
  content,
  accent,
  saveSignal,
}: {
  bookId: number
  chapterIndex: number
  content: string
  accent: string
  saveSignal?: string | number
}) {
  const { settings } = useSettings()
  const language = settings.language as keyof typeof ui
  const copy = ui[language] ?? ui.es
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState<Busy>("load")
  const [project, setProject] = useState<AdvancedDirectionProjectV2 | null>(null)
  const [proposal, setProposal] = useState<AdvancedDirectionProjectV2 | null>(null)
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [mode, setMode] = useState<DirectionAgentMode>("replace_unlocked")
  const [agent, setAgent] = useState({ configured: false, paperBalance: 0, promptVersion: "" })
  const [stale, setStale] = useState(false)
  const [voicePage, setVoicePage] = useState(0)
  const [notice, setNotice] = useState("")
  const paragraphs = useMemo(() => narrativeParagraphsFor(content), [content])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy("load")
      Promise.all([
        fetch(`/api/books/${bookId}/direction/${chapterIndex}`, { credentials: "include" }),
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))
          .then(buffer => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("")),
      ])
      .then(async response => {
        if (!response[0].ok) throw new Error(await response[0].text())
        return [await response[0].json() as DirectionResponse, response[1]] as const
      })
      .then(([data, localHash]) => {
        if (cancelled) return
        setProject(data.project)
        setAgent(data.agent)
        const textIsStale = data.stale || data.contentHash !== localHash
        setStale(textIsStale)
        setVoicePage(0)
        setQuote(null)
        setProposal(null)
        setNotice(textIsStale ? copy.stale : "")
      })
      .catch(error => !cancelled && setNotice(messageFor(error, copy.error)))
      .finally(() => !cancelled && setBusy(null))
    }, 500)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [bookId, chapterIndex, content, saveSignal, copy.error, copy.stale])

  async function requestQuote() {
    setBusy("quote")
    setNotice("")
    try {
      const response = await apiRequest("POST", `/api/books/${bookId}/direction/${chapterIndex}/quote`, {
        requestKey: crypto.randomUUID(),
        mode,
      })
      setQuote(await response.json() as QuoteResponse)
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  async function runAgent() {
    if (!quote) return
    setBusy("run")
    setNotice("")
    try {
      const response = await apiRequest("POST", `/api/books/${bookId}/direction/${chapterIndex}/run`, { requestKey: quote.requestKey })
      const data = await response.json() as { proposal: AdvancedDirectionProjectV2; paperCharged: number }
      setProposal(data.proposal)
      setAgent(current => ({ ...current, paperBalance: Math.max(0, current.paperBalance - data.paperCharged) }))
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  async function applyProposal() {
    if (!proposal) return
    setBusy("save")
    setNotice("")
    try {
      const { bookId: _bookId, chapterIndex: _chapter, revision: _revision, contentHash: _hash, ...editable } = proposal
      const response = await apiRequest("PUT", `/api/books/${bookId}/direction/${chapterIndex}`, {
        expectedRevision: project?.revision ?? 0,
        runRequestKey: quote?.requestKey,
        project: editable,
      })
      const data = await response.json() as { project: AdvancedDirectionProjectV2 }
      setProject(data.project)
      setProposal(null)
      setQuote(null)
      setStale(false)
      setVoicePage(0)
      setNotice(copy.applied)
    } catch (error) {
      setNotice(messageFor(error, copy.error))
    } finally {
      setBusy(null)
    }
  }

  function updateVoiceNote(spanId: string, patch: Partial<DirectionVoiceNoteV2>) {
    setProposal(current => current ? {
      ...current,
      voiceNotes: current.voiceNotes.map(note => note.spanId === spanId ? { ...note, ...patch } : note),
      voiceProject: {
        ...current.voiceProject,
        spans: current.voiceProject.spans.map(span => span.id === spanId && patch.locked !== undefined ? { ...span, locked: patch.locked } : span),
      },
    } : current)
  }

  function toggleMusicLock(regionId: string, locked: boolean) {
    setProposal(current => current ? {
      ...current,
      musicNodes: current.musicNodes.map(node => node.regionId === regionId ? { ...node, locked } : node),
      musicProject: {
        ...current.musicProject,
        regions: current.musicProject.regions.map(region => region.id === regionId ? { ...region, locked } : region),
      },
    } : current)
  }

  const visible = proposal ?? project
  const voicePageSize = proposal ? 24 : 8
  const voicePages = Math.max(1, Math.ceil((visible?.voiceNotes.length ?? 0) / voicePageSize))
  const visibleVoiceNotes = visible?.voiceNotes.slice(voicePage * voicePageSize, (voicePage + 1) * voicePageSize) ?? []
  const expiresSoon = quote ? new Date(quote.expiresAt).getTime() <= Date.now() : false

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[.08] bg-white/[.025]" dir={language === "ar" ? "rtl" : undefined}>
      <button type="button" onClick={() => setOpen(value => !value)} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ color: accent, background: `${accent}14`, border: `1px solid ${accent}25` }}>
          <Bot className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-white/80">{copy.title}</span>
          <span className="mt-0.5 block truncate text-[10px] text-white/35">{copy.hidden} · v2</span>
        </span>
        {busy === "load" ? <Loader2 className="h-4 w-4 animate-spin text-white/25" /> : open ? <ChevronUp className="h-4 w-4 text-white/25" /> : <ChevronDown className="h-4 w-4 text-white/25" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/[.06] p-3.5 sm:p-4">
          <div className="rounded-xl border border-white/[.06] bg-black/20 p-3">
            <p className="text-xs leading-relaxed text-white/55">{copy.subtitle}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-200/55"><FileLock2 className="h-3 w-3" />{copy.safety}</p>
          </div>

          {!agent.configured && <p className="rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-3 text-[11px] text-amber-100/60">{copy.unavailable}</p>}
          {stale && <p className="rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-3 text-[11px] text-amber-100/60">{copy.stale}</p>}

          {!proposal && (
            <>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/20 p-1">
                {([
                  ["replace_unlocked", copy.replace],
                  ["fill_gaps", copy.gaps],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => { setMode(value); setQuote(null) }} className="min-h-10 rounded-lg px-2 text-[10px] leading-tight transition-colors" style={mode === value ? { color: accent, background: `${accent}14`, border: `1px solid ${accent}25` } : { color: "rgba(255,255,255,.3)", border: "1px solid transparent" }}>{label}</button>
                ))}
              </div>

              {!quote ? (
                <button type="button" disabled={!agent.configured || stale || busy !== null} onClick={requestQuote} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-35" style={{ color: "#050505", background: accent }}>
                  {busy === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{copy.quote}
                </button>
              ) : (
                <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: `${accent}25`, background: `${accent}08` }}>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[9px] uppercase tracking-wider text-white/25">{copy.estimated}</p><p className="mt-1 text-sm font-semibold text-white/75">{quote.estimatedPaper}</p></div>
                    <div><p className="text-[9px] uppercase tracking-wider text-white/25">{copy.maximum}</p><p className="mt-1 text-sm font-semibold" style={{ color: accent }}>{quote.maximumPaper}</p></div>
                    <div><p className="text-[9px] uppercase tracking-wider text-white/25">{copy.balance}</p><p className="mt-1 text-sm font-semibold text-white/75">{quote.paperBalance}</p></div>
                  </div>
                  <button type="button" disabled={busy !== null || expiresSoon || quote.paperBalance < quote.maximumPaper} onClick={runAgent} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-35" style={{ color: "#050505", background: accent }}>
                    {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}{copy.run}
                  </button>
                </div>
              )}
            </>
          )}

          {busy === "run" && <div className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-black/25 p-4"><Loader2 className="h-5 w-5 shrink-0 animate-spin" style={{ color: accent }} /><p className="text-xs leading-relaxed text-white/50">{copy.analyzing}</p></div>}

          {visible && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/35">{proposal ? copy.review : `${copy.title} · r${visible.revision}`}</p>
              </div>

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/30"><Volume2 className="h-3.5 w-3.5" />{copy.voice} · {visible.voiceNotes.length} {copy.cues}</p>
                {visibleVoiceNotes.map(note => {
                  const span = visible.voiceProject.spans.find(candidate => candidate.id === note.spanId)
                  const excerpt = span ? paragraphs[span.paragraphIndex]?.slice(span.startOffset, span.endOffset) : ""
                  return (
                    <div key={note.spanId} className="rounded-xl border border-white/[.06] bg-black/20 p-3">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 line-clamp-2 font-serif text-xs leading-relaxed text-white/55">{excerpt}</p>
                        {proposal && <button type="button" onClick={() => updateVoiceNote(note.spanId, { locked: !note.locked })} className="shrink-0 p-1.5 text-white/30" aria-label={copy.locked}>{note.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>}
                      </div>
                      {proposal ? (
                        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                          <select value={note.emotion} onChange={event => updateVoiceNote(note.spanId, { emotion: event.target.value as DirectionVoiceNoteV2["emotion"] })} className="min-h-9 rounded-lg border border-white/[.07] bg-zinc-950 px-2 text-[10px] text-white/55">{directionEmotionSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                          <select value={note.projection} onChange={event => updateVoiceNote(note.spanId, { projection: event.target.value as DirectionVoiceNoteV2["projection"] })} className="min-h-9 rounded-lg border border-white/[.07] bg-zinc-950 px-2 text-[10px] text-white/55">{directionProjectionSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                          <select value={note.vocalState} onChange={event => updateVoiceNote(note.spanId, { vocalState: event.target.value as DirectionVoiceNoteV2["vocalState"] })} className="min-h-9 rounded-lg border border-white/[.07] bg-zinc-950 px-2 text-[10px] text-white/55">{directionVocalStateSchema.options.map(value => <option key={value} value={value}>{value}</option>)}</select>
                          <input value={note.elevenLabsTags.join(", ")} onChange={event => updateVoiceNote(note.spanId, { elevenLabsTags: event.target.value.split(",").map(value => value.trim()).filter(Boolean).slice(0, 12) })} className="min-h-9 rounded-lg border border-white/[.07] bg-zinc-950 px-2 text-[10px] text-white/55 sm:col-span-3" placeholder="ElevenLabs: sad, near tears…" />
                        </div>
                      ) : <p className="mt-1.5 text-[10px] text-white/28">{note.emotion} · {note.projection} · {note.vocalState}{note.locked ? ` · ${copy.locked}` : ""}</p>}
                    </div>
                  )
                })}
                {voicePages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-1 text-[10px] text-white/35">
                    <button type="button" disabled={voicePage === 0} onClick={() => setVoicePage(page => Math.max(0, page - 1))} className="rounded-lg border border-white/[.07] p-1.5 disabled:opacity-25" aria-label="Anterior"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <span>{voicePage + 1} / {voicePages}</span>
                    <button type="button" disabled={voicePage >= voicePages - 1} onClick={() => setVoicePage(page => Math.min(voicePages - 1, page + 1))} className="rounded-lg border border-white/[.07] p-1.5 disabled:opacity-25" aria-label="Siguiente"><ChevronRight className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/30"><Music2 className="h-3.5 w-3.5" />{copy.music} · {visible.musicNodes.length} {copy.cues}</p>
                {visible.musicNodes.length === 0 && <p className="rounded-xl border border-dashed border-white/[.07] p-3 text-center text-[10px] text-white/25">{copy.noMusic}</p>}
                {visible.musicNodes.map(node => {
                  const region = visible.musicProject.regions.find(candidate => candidate.id === node.regionId)
                  return <div key={node.regionId} className="flex items-center gap-2 rounded-xl border border-white/[.06] bg-black/20 p-3"><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/55">{region?.name || node.regionId}</p><p className="mt-1 text-[10px] text-white/25">score {node.scoreId ?? "—"} · {node.layerIds.length} nodos · {node.crossfadeSeconds}s</p></div>{proposal && <button type="button" onClick={() => toggleMusicLock(node.regionId, !node.locked)} className="shrink-0 p-1.5 text-white/30" aria-label={copy.locked}>{node.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>}</div>
                })}
              </div>
            </div>
          )}

          {proposal && (
            <button type="button" disabled={busy !== null || stale} onClick={applyProposal} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold disabled:opacity-40" style={{ color: "#050505", background: accent }}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{copy.apply}
            </button>
          )}
          {notice && <p className="rounded-xl border border-white/[.06] bg-black/20 p-3 text-[11px] leading-relaxed text-white/50">{notice}</p>}
        </div>
      )}
    </section>
  )
}
