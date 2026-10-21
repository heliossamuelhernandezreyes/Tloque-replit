import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import { createEditionProject, readEditionProject, type EditionProject } from "./project"
import { downloadFile, printFilename, verifyPrintImage } from "./browserFiles"
import type { PrintBook, EditionSettings } from "./model"
import type { PrintResources } from "./resources"
import type { PrintImage } from "./cover"
import { homeText } from "./homeStrings"

export default function PrintProjectPanel({ book, settings, resources, blurb, art, backArt, language, disabled, onLoad }: {
  book: PrintBook; settings: EditionSettings; resources: PrintResources; blurb: string
  art: PrintImage | null; backArt: PrintImage | null; language: string; disabled: boolean; onLoad: (project: EditionProject) => void
}) {
  const t = homeText(language), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const [project, setProject] = useState<EditionProject | null>(null)
  useEffect(() => {
    let active = true
    setProject(null)
    void createEditionProject(book, settings, resources, blurb, art, backArt).then(value => { if (active) setProject(value) }).catch(() => { if (active) setError(t("projectError")) })
    return () => { active = false }
  }, [book, settings, resources, blurb, art, backArt, language])
  const save = () => {
    if (!project) return
    setBusy(true); setError("")
    // Prepare the revision digest in advance so the file save stays directly
    // inside the click gesture, including in mobile browsers.
    try { downloadFile(JSON.stringify(project), printFilename(book.title, "edition", "json"), "application/json") }
    catch { setError(t("projectError")) } finally { setBusy(false) }
  }
  const load = async (input: HTMLInputElement) => {
    const file = input.files?.[0]; input.value = ""
    if (!file || busy || disabled) return
    setBusy(true); setError("")
    try {
      if (file.size > 100_000_000) throw new Error("project")
      const project = await readEditionProject(JSON.parse(await file.text()), book)
      for (const image of [project.art, project.backArt, ...project.resources.symbols.map(s => s.image), ...project.resources.illustrations.map(i => i.image)]) if (image) await verifyPrintImage(image)
      onLoad(project)
    } catch (error) { setError(t(error instanceof Error && error.message === "projectMismatch" ? "projectMismatch" : "projectError")) }
    finally { setBusy(false) }
  }
  return <details className="print-details print-project"><summary>{t("project")}</summary>
    <p className="print-note">{t("projectHint")}</p>
    <button className="print-secondary" disabled={disabled || busy || !project} onClick={save}><Download />{t("saveProject")}</button>
    <label className="print-field print-upload"><span>{t("loadProject")}</span><input aria-label={t("loadProject")} type="file" accept=".json" disabled={disabled || busy} onChange={e => void load(e.currentTarget)} /></label>
    {error && <p role="alert" className="print-note">{error}</p>}
  </details>
}
