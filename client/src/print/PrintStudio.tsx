import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, Layers3, Loader2, Printer, RotateCcw, SlidersHorizontal, TriangleAlert, X, ZoomIn } from "lucide-react"
import { useSettings } from "@/context/SettingsContext"
import { DEFAULT_EDITION, PRINT_VERSION, editionSettings, imposeBooklet, pageSize, printLabels, printSourceCredits, useTemplate, type EditionLayout, type EditionSettings, type PdfCopy, type PrintBook, type PrintDestination, type PrintIssue } from "./model"
import { issueText, printText } from "./strings"
import type { CoverLayout, PrintImage } from "./cover"
import type { ExportKind, WorkerRequest, WorkerResponse } from "./print.worker"
import { downloadFile, loadCoverImage, printFilename } from "./browserFiles"
import PrintPreview from "./PrintPreview"
import PrintResourcesPanel from "./PrintResourcesPanel"
import { emptyPrintResources } from "./resources"
import { bookSettingsKey, initialEditionSettings, manuscriptFingerprint, type EditionProject } from "./project"
import { homeText } from "./homeStrings"
import { printerProfile, signatureSize, type PrintSelection, type PrinterProfile } from "./homeJob"
import { prepareOfflinePrint } from "./offline"
import PrintJobPanel from "./PrintJobPanel"
import { NumberField } from "./controls"
import PrintProjectPanel from "./PrintProjectPanel"
import workerUrl from "./print.worker.ts?worker&url"
import "./print.css"

const STORAGE = "tloque_print_edition_v1"
function initialSettings(book: PrintBook, destination?: PrintDestination): EditionSettings {
  return initialEditionSettings(book, localStorage, destination)
}
const PRINTER_STORAGE = "tloque_print_printer_v2"
function initialPrinter() { try { return printerProfile(JSON.parse(localStorage.getItem(PRINTER_STORAGE) || "{}")) } catch { return printerProfile() } }
function Toggle({ children, checked, onChange }: { children: ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="print-toggle"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{children}</span></label>
}

export default function PrintStudio({ book, copy, destination, onClose }: { book: PrintBook; copy?: PdfCopy; destination?: PrintDestination; onClose: () => void }) {
  const { settings: appSettings } = useSettings(), language = appSettings.language, t = printText(language)
  const h = homeText(language)
  const [settings, setSettings] = useState(() => initialSettings(book, destination))
  const [step, setStep] = useState(0), [part, setPart] = useState<"interior" | "cover">("interior")
  const [mobileView, setMobileView] = useState<"controls" | "preview">("controls"), [zoom, setZoom] = useState(false)
  const [page, setPage] = useState(0), [guides, setGuides] = useState(false), [coverPage, setCoverPage] = useState(0)
  const [art, setArt] = useState<PrintImage | null>(null), [backArt, setBackArt] = useState<PrintImage | null>(null), [artLoading, setArtLoading] = useState(!!(book.coverUrl || book.backCoverUrl))
  const [blurb, setBlurb] = useState(book.synopsis || ""), [coverConfirmed, setCoverConfirmed] = useState(false)
  const [result, setResult] = useState<{ interior: EditionLayout; cover: CoverLayout } | null>(null)
  const [busy, setBusy] = useState(true), [exporting, setExporting] = useState(false), [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0), [saved, setSaved] = useState(false)
  const [resources, setResources] = useState(emptyPrintResources)
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [profile, setProfile] = useState(initialPrinter), [calibrated, setCalibrated] = useState(false)
  const [offline, setOffline] = useState<"preparing" | "ready" | "unavailable">("preparing")
  const [canceled, setCanceled] = useState(false)
  const [exports, setExports] = useState<{ filename: string; sha256: string; bytes: number }[]>([])
  const exportSuffix = useRef("")
  const worker = useRef<Worker | null>(null), heading = useRef<HTMLHeadingElement>(null)
  const size = pageSize(settings)
  const paperWidth = settings.paper === "letter" ? 215.9 : 210, paperHeight = settings.paper === "letter" ? 279.4 : 297
  const coverSize = settings.destination === "press" ? result?.cover : settings.binding === "saddle" ? { width: paperHeight, height: paperWidth } : { width: paperWidth, height: paperHeight }
  useEffect(() => { setCalibrated(false); setCoverPage(0) }, [settings.destination, settings.paper])
  useEffect(() => setCoverPage(0), [settings.binding])

  useEffect(() => {
    let active = true
    void prepareOfflinePrint(workerUrl).then(ready => { if (active) setOffline(ready ? "ready" : "unavailable") }).catch(() => { if (active) setOffline("unavailable") })
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000)
    setArtLoading(!!(book.coverUrl || book.backCoverUrl))
    Promise.all([loadCoverImage(book.coverUrl, abort.signal), loadCoverImage(book.backCoverUrl, abort.signal)]).then(([image, backImage]) => { if (!abort.signal.aborted) { setArt(image); setBackArt(backImage); setArtLoading(false) } })
    const failed = () => setArtLoading(false)
    abort.signal.addEventListener("abort", failed)
    return () => { abort.signal.removeEventListener("abort", failed); abort.abort(); clearTimeout(timer) }
  }, [book.coverUrl, book.backCoverUrl, attempt])

  useEffect(() => {
    setBusy(true); setExporting(false); setError(""); setCoverConfirmed(false); setExports([])
    const timer = setTimeout(() => {
      const task = new Worker(workerUrl, { type: "module" })
      worker.current = task
      task.onmessage = async (event: MessageEvent<WorkerResponse>) => {
        if (worker.current !== task) return
        const data = event.data
        if (data.type === "ready") { setResult(data); setBusy(false); setPage(p => Math.min(p, Math.max(0, data.interior.pages.length - 1))) }
        else if (data.type === "file") {
          try {
            const hash = await crypto.subtle.digest("SHA-256", data.buffer)
            if (worker.current !== task) return
            const filename = printFilename(book.title, exportSuffix.current || data.kind)
            const sha256 = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("")
            setExports(previous => [...previous.filter(f => f.filename !== filename), { filename, sha256, bytes: data.buffer.byteLength }])
            downloadFile(data.buffer, filename, "application/pdf"); setExporting(false)
          } catch { if (worker.current === task) { setError("generation"); setExporting(false) } }
        } else { setError(data.message); setBusy(false); setExporting(false) }
      }
      task.onerror = () => { if (worker.current === task) { setError("generation"); setBusy(false); setExporting(false) } }
      const request: WorkerRequest = { type: "compose", book: { ...book, synopsis: blurb }, settings,
        labels: printLabels(book.originalLanguage || language), language, kitLabels: { cut: t("cut"), fold: t("fold"), glue: t("glue") },
        copy, origin: window.location.origin, art, backArt, resources }
      task.postMessage(request)
    }, 280)
    return () => { clearTimeout(timer); worker.current?.terminate(); worker.current = null }
  }, [book, settings, language, copy, art, backArt, blurb, attempt, resources])

  const update = (patch: Partial<EditionSettings>, resetSpine = true) => {
    setBusy(true)
    const next = editionSettings({ ...settings, ...patch, ...(resetSpine ? { spineMm: 0 } : {}) })
    setSettings(next)
    try {
      localStorage.setItem(bookSettingsKey(book), JSON.stringify({ ...next, spineMm: 0 }))
      const { textMode: _textMode, ...visual } = next
      localStorage.setItem(STORAGE, JSON.stringify({ ...visual, spineMm: 0 })); setSaved(true)
    } catch { setSaved(false) }
  }
  const navigate = (next: number) => { setStep(next); setMobileView("controls"); requestAnimationFrame(() => heading.current?.focus()) }
  const plan = useMemo(() => result?.interior.pages.length ? imposeBooklet(result.interior.pages.length, signatureSize(settings)) : null, [result, settings.signature, settings.binding])
  const issues: PrintIssue[] = result ? [...result.interior.issues, ...result.cover.issues] : []
  const interiorBlocked = !result?.interior.pages.length || !!error || issues.some(i => i.scope === "interior" && i.severity === "error")
  const kitTooWide = settings.destination === "booklet" && settings.binding === "bound" && size.width + settings.spineMm > (settings.paper === "letter" ? 215.9 : 210) - 20
  const coverBlocked = interiorBlocked || artLoading || kitTooWide || issues.some(i => i.scope === "cover" && i.severity === "error")
  const inFlight = busy || exporting || resourcesLoading
  const exportPdf = (kind: ExportKind, selection?: PrintSelection) => {
    if (inFlight || interiorBlocked || (["cover", "coverKit", "coverHome"].includes(kind) && (coverBlocked || !coverConfirmed))) return
    if (profile.duplex === "manual" && settings.destination !== "press" && !(kind === "interior" && settings.destination === "booklet") && ["interior", "booklet", "proof"].includes(kind) && (!calibrated || !selection?.pass || selection.pass === "all")) return
    exportSuffix.current = kind + (selection?.signature ? "-cuadernillo-" + selection.signature : "") + (selection?.sheet ? "-hoja-" + selection.sheet : "") + (selection?.pass && selection.pass !== "all" ? "-" + selection.pass : "")
    setCanceled(false); setExporting(true); worker.current?.postMessage({ type: "export", kind, selection, profile } satisfies WorkerRequest)
  }
  const changePrinter = (value: PrinterProfile) => {
    const next = printerProfile(value); setProfile(next); setCalibrated(false)
    try { localStorage.setItem(PRINTER_STORAGE, JSON.stringify(next)) } catch { /* session profile */ }
  }
  const restore = (project: EditionProject) => {
    setBusy(true); setSettings(project.settings); setResources(project.resources); setBlurb(project.blurb)
    setArt(project.art); setBackArt(project.backArt); setCoverConfirmed(false); setPage(0)
    try { localStorage.setItem(bookSettingsKey(book), JSON.stringify({ ...project.settings, spineMm: 0 })) } catch { /* loaded in memory */ }
  }
  const report = async () => {
    if (!result || busy) return
    const l = result.interior, c = result.cover
    const fingerprint = await manuscriptFingerprint(book)
    const lines = ["TLOQUE · " + h("job"), book.title, book.author, "Motor: " + PRINT_VERSION, "SHA-256 manuscrito: " + fingerprint,
      ...printSourceCredits(book, printLabels(language)), "", t("format") + ": " + t(settings.destination),
      t("trim") + ": " + l.width + " × " + l.height + " mm", l.pages.length + " " + t("pages") + " · " + l.wordCount + " " + t("words"),
      t("typeHint") + " · " + settings.bodyPt + " pt · " + t("leading") + ": " + settings.leading,
      t("margins") + ": " + (["inner", "outer", "top", "bottom"] as const).map(k => t(k) + " " + settings[k]).join("; "),
      t("textMode") + ": " + t(settings.textMode), t("blanks") + ": " + l.pages.filter(p => p.kind === "blank").length,
      ...(copy ? ["Folio: " + copy.folio] : []), "",
      ...(settings.destination !== "press" ? [h("method") + ": " + h(profile.duplex), h("reverse") + ": " + profile.reverseBacks, h("rotate") + ": " + profile.rotateBacks,
        h("offsetX") + ": " + profile.offsetX, h("offsetY") + ": " + profile.offsetY, h("jobScale"), h("binding") + ": " + h(settings.binding),
        h("jobSteps"), h(settings.binding === "loose" ? "looseHint" : settings.binding === "saddle" ? "saddleHint" : "boundHint"), ...(profile.duplex === "manual" ? [h("manualHint")] : []), ""] : []),
      t(settings.destination === "press" ? "pressInstructions" : settings.destination === "home" ? "homeInstructions" : "bookletInstructions"),
      "", t("cover") + ": " + c.width + " × " + c.height + " mm", t("spine") + ": " + (c.spine || "?") + "; " + t("bleed") + ": " + c.bleed,
      t("ppi") + ": " + (c.ppi ?? t("noCover")), t("pdfLimit"), t("original"), "", t("preflight"), ...issues.map(i => "- " + issueText(language, i))]
    if (settings.destination === "booklet" && plan) {
      lines.push("", t("kitHint"), "", t("plan"), plan.sides.length / 2 + " " + t("sheets") + " · " + plan.signatures + " " + t("signatures") + " · " + plan.blanks + " " + t("blanks"),
        [t("group"), t("sheet"), t("side"), t("left"), t("right")].join(" | "))
      plan.sides.forEach(s => lines.push([s.signature, s.sheet, t(s.side === "front" ? "front" : "backSide"), s.left, s.right].join(" | ")))
    }
    lines.push("", "SHA-256 PDF", ...exports.map(file => file.filename + " | " + file.bytes + " bytes | " + file.sha256))
    downloadFile(lines.join("\n"), printFilename(book.title, "print-job", "txt"), "text/plain;charset=utf-8")
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal>
    <Dialog.Overlay className="print-overlay" />
    <Dialog.Content className="print-studio" aria-describedby="print-description" onPointerDownOutside={e => e.preventDefault()}>
      <header className="print-topbar"><div className="print-brand"><BookOpen aria-hidden="true" /><div><p>{t("subtitle")}</p><Dialog.Title>{t("title")}</Dialog.Title></div></div><Dialog.Close className="print-icon" aria-label={t("close")}><X /></Dialog.Close></header>
      <Dialog.Description id="print-description" className="print-book-name">{book.title}<span> · {book.author}</span></Dialog.Description>
      <nav className="print-steps" aria-label={t("title")}>{(["format", "design", "review"] as const).map((key, i) => <button key={key} type="button" aria-label={"0" + (i + 1) + " " + t(key)} aria-current={step === i ? "step" : undefined} onClick={() => navigate(i)}><span>{i < step ? <Check size={13} /> : "0" + (i + 1)}</span>{t(key)}</button>)}</nav>
      <div className="print-mobile-tabs"><button aria-pressed={mobileView === "controls"} onClick={() => setMobileView("controls")}>{t("adjustments")}</button><button aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}>{t("previewTab")}</button></div>
      <div className="print-workspace" data-mobile-view={mobileView}>
        <section className="print-controls" aria-label={t((["format", "design", "review"] as const)[step])}>
          <h2 tabIndex={-1} ref={heading}>{t(step === 0 ? "destination" : step === 1 ? "style" : "preflight")}</h2>
          {step === 0 && <>
            <div className="print-choices">{(["press", "home", "booklet"] as const).map((key, i) => {
              const Icon = [Printer, FileText, Layers3][i]
              return <button key={key} className="print-choice" aria-pressed={settings.destination === key} onClick={() => { update({ destination: key, recto: key === "press", binding: key === "home" ? "loose" : "bound", economyCover: key !== "press" }); setPart("interior") }}><Icon aria-hidden="true" /><span><strong>{t(key)}</strong><small>{t(key === "press" ? "pressHint" : key === "home" ? "homeHint" : "bookletHint")}</small></span><span className="print-radio">{settings.destination === key && <Check size={12} />}</span></button>
            })}</div>
            {settings.destination === "press" ? <label className="print-field"><span>{t("trim")}</span><select aria-label={t("trim")} value={settings.trim} onChange={e => update({ trim: e.target.value as EditionSettings["trim"] })}>{(["a5", "trade", "digest"] as const).map(key => <option value={key} key={key}>{t(key)}</option>)}</select></label>
              : <label className="print-field"><span>{t("paper")}</span><select aria-label={t("paper")} value={settings.paper} onChange={e => update({ paper: e.target.value as EditionSettings["paper"] })}><option value="letter">{t("letter")}</option><option value="a4">{t("a4")}</option></select></label>}
            {settings.destination === "booklet" && settings.binding === "bound" && <><label className="print-field"><span>{t("signature")}</span><select aria-label={t("signature")} value={settings.signature} onChange={e => update({ signature: Number(e.target.value) as EditionSettings["signature"] })}>{[4, 8, 16, 32].map(n => <option key={n} value={n}>{n} · {n / 4} {t("sheets")}</option>)}</select></label><p className="print-note">{t("signatureHint")}</p></>}
            {settings.destination !== "press" && <>
              {settings.destination === "booklet" && <label className="print-field"><span>{h("binding")}</span><select aria-label={h("binding")} value={settings.binding} onChange={e => update({ binding: e.target.value as EditionSettings["binding"] })}><option value="bound">{h("bound")}</option><option value="saddle">{h("saddle")}</option></select></label>}
              <p className="print-note">{h(settings.binding === "loose" ? "looseHint" : settings.binding === "saddle" ? "saddleHint" : "boundHint")}</p>
            </>}
            <div className="print-measure"><span>{t("trim")}</span><strong>{size.width} <i>×</i> {size.height} <small>mm</small></strong></div>
            <p className="print-note">{copy ? t("copyHint") : t("genericHint")}</p>
          </>}
          {step === 1 && <>
            <div className="print-templates">{(["classic", "contemporary", "large"] as const).map(key => <button key={key} aria-pressed={settings.template === key} onClick={() => update(useTemplate(settings, key))}><span className={"print-type-sample print-type-" + key}>Aa</span><strong>{t(key)}</strong><small>{t(key === "classic" ? "classicHint" : key === "large" ? "largeHint" : "contemporaryHint")}</small></button>)}</div>
            <p className="print-font-note">{t("typeHint")}</p>
            <PrintResourcesPanel book={book} settings={settings} resources={resources} language={language} loading={resourcesLoading} onLoading={setResourcesLoading} onChange={value => { setBusy(true); setResources(value); update({}) }} />
            <div className="print-fields"><NumberField label={t("size")} value={settings.bodyPt} min={9} max={18} step={.5} onChange={bodyPt => update({ bodyPt })} /><NumberField label={t("leading")} value={settings.leading} min={1.2} max={1.8} step={.05} onChange={leading => update({ leading })} /></div>
            <details className="print-details"><summary><SlidersHorizontal size={15} />{t("margins")}</summary><div className="print-fields">{(["inner", "outer", "top", "bottom"] as const).map(key => <NumberField key={key} label={t(key)} value={settings[key]} min={key === "outer" ? 13 : 16} max={key === "inner" ? 40 : key === "outer" ? 30 : 34} onChange={value => update({ [key]: value })} />)}</div></details>
            <div className="print-section-title">{t("structure")}</div>
            {(["recto", "toc", "headers", "justify"] as const).map(key => <Toggle key={key} checked={settings[key]} onChange={value => update({ [key]: value })}>{t(key)}</Toggle>)}
            <label className="print-field"><span>{t("textMode")}</span><select aria-label={t("textMode")} value={settings.textMode} onChange={e => update({ textMode: e.target.value as EditionSettings["textMode"] })}>{(["paragraphs", "reflow", "verse"] as const).map(key => <option key={key} value={key}>{t(key)}</option>)}</select></label><p className="print-note">{t("textHint")}</p>
          </>}
          {step === 2 && <>
            <div className={"print-check-status" + (interiorBlocked ? " print-check-error" : "")}>{interiorBlocked ? <TriangleAlert /> : <CheckCircle2 />}<span>{t(interiorBlocked ? "blocked" : "ready")}</span></div>
            <p className="print-note">{profile.duplex === "manual" && settings.destination !== "press" ? h("jobScale") : t(settings.destination === "press" ? "pressInstructions" : settings.destination === "home" ? "homeInstructions" : "bookletInstructions")}</p>
            {issues.filter(i => i.scope === "interior").map((i, n) => <div className="print-issue" role={i.severity === "error" ? "alert" : undefined} key={n}><TriangleAlert size={15} /><span>{issueText(language, i)}{i.page && <button onClick={() => { setPage(i.page! - 1); setPart("interior"); setMobileView("preview") }}>{t("page")} {i.page}</button>}</span></div>)}
            {settings.destination === "press" ? <button className="print-primary" disabled={inFlight || interiorBlocked} onClick={() => exportPdf("interior")}><Download />{t("export")}</button>
              : result && result.interior.pages.length > 0 && <PrintJobPanel layout={result.interior} profile={profile} calibrated={calibrated} language={language} disabled={inFlight || interiorBlocked} onProfile={changePrinter} onCalibrated={setCalibrated} onExport={exportPdf} />}
            {exporting && <div className="print-export-status" role="status"><Loader2 className="animate-spin" size={16} />{h("exporting")}<button className="print-secondary" onClick={() => { worker.current?.terminate(); worker.current = null; setExporting(false); setCanceled(true); setAttempt(n => n + 1) }}>{h("cancel")}</button></div>}
            {canceled && <p role="status" className="print-note">{h("canceled")}</p>}
            {settings.destination === "booklet" && <button className="print-secondary" disabled={inFlight || interiorBlocked} onClick={() => exportPdf("interior", { pass: "all" })}><FileText />{t("export")}</button>}
            <details className="print-details print-cover-settings" onToggle={e => { if (e.currentTarget.open) setPart("cover") }}><summary>{t("coverSettings")}</summary>
              {settings.binding === "bound" && <><div className="print-fields"><NumberField label={t("spine")} value={settings.spineMm} min={0} max={70} step={.1} onChange={spineMm => update({ spineMm }, false)} /><NumberField label={t("bleed")} value={settings.bleedMm} min={3} max={6} step={.1} onChange={bleedMm => update({ bleedMm }, false)} /></div><p className="print-note">{settings.destination === "press" ? t("spineHint") : h("homeSpine")}</p></>}
              <Toggle checked={settings.economyCover} onChange={economyCover => update({ economyCover }, false)}>{h("economy")}</Toggle><p className="print-note">{h("economyHint")}</p>
              <Toggle checked={settings.coverArt} onChange={coverArt => update({ coverArt }, false)}>{t("artwork")}</Toggle>
              {book.backCoverUrl && <><Toggle checked={settings.backCoverArt} onChange={backCoverArt => update({ backCoverArt }, false)}>{t("backArtwork")}</Toggle><p className="print-note">{t("backArtworkHint")}</p></>}
              <label className="print-field"><span>{t("blurb")}</span><textarea disabled={!!(settings.backCoverArt && backArt)} aria-label={t("blurb")} value={blurb} onChange={e => { setBusy(true); setBlurb(e.target.value) }} rows={5} maxLength={8000} /></label><p className="print-note">{t("blurbHint")}</p>
              {issues.filter(i => i.scope === "cover" && (settings.destination === "press" || i.code !== "colorProfile")).map((i, n) => <div className="print-issue" key={n}><TriangleAlert size={14} /><span>{issueText(language, i)}</span></div>)}
              {settings.destination !== "press" && <p className="print-note">{settings.binding === "bound" ? t("kitHint") : h(settings.binding === "saddle" ? "saddleHint" : "looseHint")}</p>}
              {kitTooWide && <p role="alert" className="print-note">{t("kitTooWide")}</p>}
              <Toggle checked={coverConfirmed} onChange={setCoverConfirmed}>{settings.destination === "press" ? t("coverConfirm") : settings.binding === "bound" ? t("kitConfirm") : h("homeCoverConfirm")}</Toggle>
              <button className="print-secondary" disabled={inFlight || coverBlocked || !coverConfirmed} onClick={() => exportPdf(settings.destination === "press" ? "cover" : "coverHome")}><Download />{settings.destination === "press" ? t("exportCover") : settings.binding === "bound" ? t("kit") : h("homeCover")}</button>
            </details>
            {settings.destination === "booklet" && plan && <details className="print-details"><summary>{t("plan")} · {plan.sides.length / 2} {t("sheets")}</summary><p className="print-note">{plan.signatures} {t("signatures")} · {plan.blanks} {t("blanks")}</p><div className="print-table-wrap"><table><thead><tr><th>{t("group")}</th><th>{t("sheet")}</th><th>{t("side")}</th><th>{t("left")}</th><th>{t("right")}</th></tr></thead><tbody>{plan.sides.map((s, i) => <tr key={i}><td>{s.signature}</td><td>{s.sheet}</td><td>{t(s.side === "front" ? "front" : "backSide")}</td><td>{s.left}</td><td>{s.right}</td></tr>)}</tbody></table></div></details>}
            <button className="print-secondary" disabled={inFlight || interiorBlocked} onClick={() => void report()}><FileText />{t("exportReport")}</button><p className="print-note">{settings.destination === "press" ? t("pdfLimit") : h("jobScale")}</p>
          </>}
          <PrintProjectPanel book={book} settings={settings} resources={resources} blurb={blurb} art={art} backArt={backArt} language={language} disabled={inFlight || artLoading} onLoad={restore} />
          <p role="status" className="print-offline-state" data-ready={offline === "ready"}>{h(offline === "ready" ? "offlineReady" : offline === "preparing" ? "offlinePreparing" : "offlineUnavailable")}</p>
          {copy && <p className="print-note">{h("offlineLicense")}</p>}
          <div className="print-controls-bottom"><button className="print-reset" onClick={() => { update({ ...DEFAULT_EDITION }); setPage(0) }}><RotateCcw size={13} />{t("reset")}</button>{saved && <span>{t("saved")}</span>}</div>
        </section>
        <section className="print-preview-pane" aria-label={t("preview")} aria-busy={busy || resourcesLoading}>
          <div className="print-preview-toolbar"><div><button aria-pressed={part === "interior"} onClick={() => setPart("interior")}>{t("interior")}</button><button aria-pressed={part === "cover"} onClick={() => setPart("cover")}>{t("cover")}</button></div><div><Toggle checked={guides} onChange={setGuides}>{t("guides")}</Toggle><button className="print-zoom" aria-label={t("zoom")} aria-pressed={zoom} onClick={() => setZoom(v => !v)}><ZoomIn size={16} /></button></div></div>
          <div className="print-stage" data-zoom={zoom}>
            {result && result.interior.pages.length > 0 && <PrintPreview interior={result.interior} cover={result.cover} page={page} part={part} guides={guides} coverPage={coverPage} language={language} label={t(part) + " · " + t("page") + " " + (part === "cover" ? coverPage + 1 : page + 1)} />}
            {!result && !error && <div className="print-empty"><BookOpen /><h3>{t("composing")}</h3><p>{t("composingHint")}</p></div>}
            {!!error && <div className="print-error" role="alert"><TriangleAlert /><p>{error === "fonts" ? t("fontsError") : error === "customFont" ? t("customFontError") : error === "resources" ? t("resourceError") : error === "missingGlyph" ? issueText(language, { code: "missingGlyph", severity: "error", scope: "interior" }) : error === "tooLong" ? issueText(language, { code: "tooLong", severity: "error", scope: "interior" }) : t("error")}</p><button className="print-secondary" onClick={() => setAttempt(n => n + 1)}>{t("retry")}</button></div>}
            {result && !result.interior.pages.length && !error && <div className="print-error" role="alert"><TriangleAlert />{result.interior.issues.map((i, n) => <p key={n}>{issueText(language, i)}</p>)}</div>}
            {busy && <div className="print-composing" role="status"><Loader2 size={14} className="animate-spin" />{t("composing")}</div>}
          </div>
          <div className="print-preview-footer">
            {part === "interior" && <><div className="print-page-controls"><button className="print-icon" aria-label={t("previousPage")} disabled={!page || busy} onClick={() => setPage(n => n - 1)}><ChevronLeft /></button><span>{t("page")} <strong>{page + 1}</strong> {t("of")} {result?.interior.pages.length || "—"}</span><button className="print-icon" aria-label={t("nextPage")} disabled={busy || !result || page >= result.interior.pages.length - 1} onClick={() => setPage(n => n + 1)}><ChevronRight /></button></div><select aria-label={t("chapter")} value={result?.interior.chapters.find(c => c.page - 1 === page)?.page || ""} onChange={e => setPage(Number(e.target.value) - 1)}><option value="" disabled>{t("chapter")}</option><option value="1">{t("titlePage")}</option>{result?.interior.chapters.map((c, i) => <option key={i} value={c.page}>{c.title}</option>)}</select></>}
            {part === "cover" && <>
              {settings.destination !== "press" && settings.binding !== "saddle" && <div className="print-cover-pages"><button className="print-secondary" aria-pressed={coverPage === 0} onClick={() => setCoverPage(0)}>{h("coverFront")}</button><button className="print-secondary" aria-pressed={coverPage === 1} onClick={() => setCoverPage(1)}>{h("coverBack")}</button></div>}
              <p>{coverSize ? coverSize.width.toFixed(2) + " × " + coverSize.height.toFixed(2) : "—"} mm · {result?.cover.ppi != null ? result.cover.ppi + " ppi" : t("noCover")}</p>
            </>}
          </div>
        </section>
      </div>
      <footer className="print-bottom"><span className="print-summary">{busy ? "…" : result?.interior.pages.length || 0} {t("pages")}<span> · {size.width} × {size.height} mm</span></span><div>{step > 0 && <button className="print-secondary" onClick={() => navigate(step - 1)}><ArrowLeft />{t("back")}</button>}{step < 2 && <button className="print-primary" onClick={() => navigate(step + 1)}>{t("next")}<ArrowRight /></button>}</div></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
