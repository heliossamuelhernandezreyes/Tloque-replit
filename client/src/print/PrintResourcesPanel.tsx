import { useState } from "react"
import { Download, Trash2, Upload } from "lucide-react"
import { downloadFile, loadPrintImage, printFilename } from "./browserFiles"
import { bytesBase64 } from "./fontAssets"
import { manuscriptParagraphs } from "./compose"
import { validatePrintResources, validSymbolToken, type PrintResources } from "./resources"
import type { EditionSettings, PrintBook } from "./model"
import { printText } from "./strings"

export default function PrintResourcesPanel({ book, settings, resources, language, loading, onChange, onLoading }: {
  book: PrintBook; settings: EditionSettings; resources: PrintResources; language: string; loading: boolean; onChange: (r: PrintResources) => void; onLoading: (loading: boolean) => void
}) {
  const t = printText(language), [token, setToken] = useState(""), [chapter, setChapter] = useState(0)
  const [after, setAfter] = useState(0), [width, setWidth] = useState(100), [caption, setCaption] = useState("")
  const [error, setError] = useState("")
  const chapters = book.chapters?.length ? book.chapters : [{ title: book.title, content: book.content || "" }]
  const paragraphs = manuscriptParagraphs(chapters[chapter]?.content || "", settings.textMode).length
  const apply = (r: PrintResources) => { onChange(validatePrintResources(r)); setError("") }
  const upload = async (input: HTMLInputElement, kind: "font" | "symbol" | "illustration" | "project") => {
    const file = input.files?.[0]; input.value = ""
    if (!file || loading) return
    onLoading(true); setError("")
    try {
      if (kind === "font") {
        if (!/\.(ttf|otf|woff|woff2)$/i.test(file.name) || file.size > 24_000_000) throw new Error("resources")
        const data = bytesBase64(new Uint8Array(await file.arrayBuffer()))
        apply({ ...resources, fonts: [...resources.fonts, { id: crypto.randomUUID(), name: file.name, data }] })
      } else if (kind === "project") {
        if (file.size > 70_000_000) throw new Error("resources")
        const project = JSON.parse(await file.text())
        if (project.book !== String(book.id ?? book.title) || project.textMode !== settings.textMode) { setError(t("resourceMismatch")); return }
        apply(validatePrintResources(project.resources))
      } else {
        const image = await loadPrintImage(file), id = crypto.randomUUID()
        if (kind === "symbol") {
          const normalized = token.trim().normalize("NFC")
          if (!validSymbolToken(normalized)) throw new Error("resources")
          apply({ ...resources, symbols: [...resources.symbols, { id, token: normalized, image }] }); setToken("")
        } else {
          apply({ ...resources, illustrations: [...resources.illustrations, { id, chapter, afterParagraph: Math.min(after, paragraphs), widthPercent: width, caption, image }] })
          setCaption("")
        }
      }
    } catch { setError(t("resourceError")) }
    finally { onLoading(false) }
  }
  const fileField = (label: string, accept: string, kind: "font" | "symbol" | "illustration" | "project", disabled = false) =>
    <label className="print-field print-upload"><span><Upload size={13} />{label}</span><input aria-label={label} type="file" accept={accept} disabled={loading || disabled} onChange={e => void upload(e.currentTarget, kind)} /></label>
  const remove = (type: "fonts" | "symbols" | "illustrations", id: string) => apply({ ...resources, [type]: resources[type].filter(item => item.id !== id) })
  return <details className="print-details print-resources"><summary>{t("resources")}</summary>
    <p className="print-note">{t("resourcesHint")}</p>
    <div className="print-section-title">{t("extraFonts")}</div><p className="print-note">{t("fontUploadHint")}</p>
    {fileField(t("uploadFont"), ".ttf,.otf,.woff,.woff2", "font", resources.fonts.length >= 8)}
    {resources.fonts.map(f => <div className="print-resource" key={f.id}><span>{f.name}</span><button className="print-icon" disabled={loading} aria-label={t("remove") + " " + f.name} onClick={() => remove("fonts", f.id)}><Trash2 /></button></div>)}
    <div className="print-section-title">{t("drawnSymbols")}</div><p className="print-note">{t("symbolHint")}</p>
    <label className="print-field"><span>{t("symbolToken")}</span><input aria-label={t("symbolToken")} value={token} maxLength={64} placeholder="[[sello]]" onChange={e => setToken(e.target.value)} /></label>
    {fileField(t("uploadSymbol"), "image/png,image/jpeg,image/webp", "symbol", !validSymbolToken(token.trim().normalize("NFC")) || resources.symbols.length >= 64)}
    {resources.symbols.map(s => <div className="print-resource" key={s.id}><img src={s.image.data} alt="" /><code>{s.token}</code><button className="print-icon" disabled={loading} aria-label={t("remove") + " " + s.token} onClick={() => remove("symbols", s.id)}><Trash2 /></button></div>)}
    <div className="print-section-title">{t("illustrations")}</div>
    <label className="print-field"><span>{t("illustrationChapter")}</span><select aria-label={t("illustrationChapter")} value={chapter} onChange={e => { setChapter(Number(e.target.value)); setAfter(0) }}>{chapters.map((c, i) => <option value={i} key={i}>{i + 1}. {c.title}</option>)}</select></label>
    <label className="print-field"><span>{t("afterParagraph")}</span><input aria-label={t("afterParagraph")} type="number" min={0} max={paragraphs} value={Math.min(after, paragraphs)} onChange={e => setAfter(Math.max(0, Math.min(paragraphs, Math.floor(Number(e.target.value) || 0))))} /></label>
    <p className="print-note">{t("paragraphHint")} {paragraphs}.</p>
    <label className="print-field"><span>{t("imageWidth")} · {width}%</span><input aria-label={t("imageWidth")} type="range" min={10} max={100} step={5} value={width} onChange={e => setWidth(Number(e.target.value))} /></label>
    <label className="print-field"><span>{t("caption")}</span><textarea aria-label={t("caption")} rows={2} maxLength={500} value={caption} onChange={e => setCaption(e.target.value)} /></label>
    {fileField(t("uploadIllustration"), "image/png,image/jpeg,image/webp", "illustration", resources.illustrations.length >= 100)}
    {resources.illustrations.map((i, n) => <div className="print-resource" key={i.id}><img src={i.image.data} alt="" /><span>{i.caption || t("illustration") + " " + (n + 1)}<small>{t("illustrationChapter")} {i.chapter + 1} · {t("afterParagraph")} {i.afterParagraph}</small></span><button className="print-icon" disabled={loading} aria-label={t("remove") + " " + (i.caption || t("illustration") + " " + (n + 1))} onClick={() => remove("illustrations", i.id)}><Trash2 /></button></div>)}
    {error && <p className="print-note" role="alert">{error}</p>}
    {loading && <p className="print-note" role="status">{t("loadingResource")}</p>}
    <p className="print-note">{t("keepResources")}</p>
    <button className="print-secondary" disabled={loading} onClick={() => downloadFile(JSON.stringify({ book: String(book.id ?? book.title), textMode: settings.textMode, resources }), printFilename(book.title, "print-resources", "json"), "application/json")}><Download />{t("saveResources")}</button>
    {fileField(t("loadResources"), ".json", "project")}
  </details>
}
