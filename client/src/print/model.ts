// Geometry in millimetres; type sizes in PostScript points.
export const PT_MM = 25.4 / 72
export const PRINT_VERSION = 1
export type PrintDestination = "press" | "home" | "booklet"
export type PrintTemplate = "classic" | "contemporary" | "large"
export type FontStyle = "normal" | "bold" | "italic"
export interface PrintBook {
  id?: string | number; title: string; author: string; synopsis?: string
  coverUrl?: string; backCoverUrl?: string; originalLanguage?: string
  publicationYear?: number | null; isClassic?: boolean; content?: string
  chapters?: { title: string; content: string }[]
}
export interface PdfCopy { folio: string; key: string }
export interface EditionSettings {
  version: 1; destination: PrintDestination; trim: "a5" | "trade" | "digest"
  paper: "letter" | "a4"; template: PrintTemplate
  bodyPt: number; leading: number; inner: number; outer: number; top: number; bottom: number
  recto: boolean; toc: boolean; headers: boolean; justify: boolean
  textMode: "paragraphs" | "reflow" | "verse"; signature: 4 | 8 | 16 | 32
  spineMm: number; bleedMm: number; coverArt: boolean
}
export const DEFAULT_EDITION: EditionSettings = {
  version: 1, destination: "press", trim: "a5", paper: "letter", template: "classic",
  bodyPt: 11, leading: 1.42, inner: 21, outer: 16, top: 19, bottom: 21,
  recto: true, toc: true, headers: true, justify: true, textMode: "paragraphs",
  signature: 16, spineMm: 0, bleedMm: 3.175, coverArt: true,
}
const pick = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T => options.includes(v as T) ? v as T : fallback
const bounded = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
export function editionSettings(value?: Partial<EditionSettings> | null): EditionSettings {
  const v = value || {}, d = DEFAULT_EDITION
  return {
    version: 1, destination: pick(v.destination, ["press", "home", "booklet"], d.destination),
    trim: pick(v.trim, ["a5", "trade", "digest"], d.trim), paper: pick(v.paper, ["letter", "a4"], d.paper),
    template: pick(v.template, ["classic", "contemporary", "large"], d.template),
    bodyPt: bounded(v.bodyPt, 9, 18, d.bodyPt), leading: bounded(v.leading, 1.2, 1.8, d.leading),
    inner: bounded(v.inner, 16, 40, d.inner), outer: bounded(v.outer, 13, 30, d.outer),
    top: bounded(v.top, 16, 34, d.top), bottom: bounded(v.bottom, 16, 34, d.bottom),
    recto: typeof v.recto === "boolean" ? v.recto : d.recto, toc: typeof v.toc === "boolean" ? v.toc : d.toc,
    headers: typeof v.headers === "boolean" ? v.headers : d.headers, justify: typeof v.justify === "boolean" ? v.justify : d.justify,
    textMode: pick(v.textMode, ["paragraphs", "reflow", "verse"], d.textMode),
    signature: pick(v.signature, [4, 8, 16, 32], d.signature), spineMm: bounded(v.spineMm, 0, 70, 0),
    bleedMm: bounded(v.bleedMm, 3, 6, d.bleedMm), coverArt: typeof v.coverArt === "boolean" ? v.coverArt : d.coverArt,
  }
}
export function useTemplate(settings: EditionSettings, template: PrintTemplate): EditionSettings {
  return { ...settings, template, bodyPt: template === "large" ? 15 : 11,
    leading: template === "large" ? 1.55 : template === "contemporary" ? 1.5 : 1.42,
    justify: template === "classic" }
}
export function pageSize(s: EditionSettings): { width: number; height: number } {
  if (s.destination === "home") return s.paper === "letter" ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 }
  if (s.destination === "booklet") return s.paper === "letter" ? { width: 139.7, height: 215.9 } : { width: 148.5, height: 210 }
  return s.trim === "trade" ? { width: 152.4, height: 228.6 } : s.trim === "digest" ? { width: 139.7, height: 215.9 } : { width: 148, height: 210 }
}
export interface PrintIssue {
  code: "missingText" | "tooLong" | "missingGlyph" | "unsupportedScript" | "gutter" | "coverMissing" | "coverResolution" | "spineRequired" | "colorProfile" | "longWord" | "coverOverflow"
  severity: "error" | "warning" | "info"; scope: "interior" | "cover"; detail?: string; page?: number
}
export interface TextOp {
  kind: "text"; text: string; x: number; y: number; width: number; pt: number; font: FontStyle
  gray: number; role: "body" | "heading" | "title" | "legal" | "toc" | "header" | "footer"
  words?: { text: string; x: number }[]; paragraph?: number; line?: number; lines?: number
}
export interface LineOp { kind: "line"; x: number; y: number; x2: number; y2: number; gray: number; weight: number }
export interface QrOp { kind: "qr"; x: number; y: number; size: number; value: string }
export type PageOp = TextOp | LineOp | QrOp
export interface PrintPage { kind: "title" | "legal" | "contents" | "chapter" | "body" | "blank"; ops: PageOp[]; chapter?: number }
export interface ChapterPosition { title: string; page: number }
export interface EditionLayout {
  width: number; height: number; pages: PrintPage[]; chapters: ChapterPosition[]
  settings: EditionSettings; issues: PrintIssue[]; wordCount: number
}
export interface FontMetrics {
  width(text: string, pt: number, style?: FontStyle): number
  hasGlyph(character: string, style?: FontStyle): boolean
}
export interface PrintLabels { contents: string; edition: string; end: string; copy: string; key: string; claim: string; rights: string }
export function printLabels(language = "es"): PrintLabels {
  const rows: Record<string, string[]> = {
    es: ["Contenido", "Edición impresa · Tloque", "Fin", "Ejemplar", "Clave", "Activa tu ejemplar digital con este código.", "Consulta la licencia y los créditos de esta edición en Tloque."],
    en: ["Contents", "Print edition · Tloque", "The end", "Copy", "Key", "Activate your digital copy with this code.", "See this edition's license and credits on Tloque."],
    fr: ["Sommaire", "Édition imprimée · Tloque", "Fin", "Exemplaire", "Clé", "Activez votre exemplaire numérique avec ce code.", "Consultez la licence et les crédits de cette édition sur Tloque."],
    de: ["Inhalt", "Druckausgabe · Tloque", "Ende", "Exemplar", "Schlüssel", "Aktiviere dein digitales Exemplar mit diesem Code.", "Lizenz und Angaben zu dieser Ausgabe findest du auf Tloque."],
    it: ["Indice", "Edizione a stampa · Tloque", "Fine", "Copia", "Chiave", "Attiva la tua copia digitale con questo codice.", "Consulta la licenza e i crediti di questa edizione su Tloque."],
    pt: ["Sumário", "Edição impressa · Tloque", "Fim", "Exemplar", "Chave", "Ative seu exemplar digital com este código.", "Consulte a licença e os créditos desta edição no Tloque."],
    ru: ["Содержание", "Печатное издание · Tloque", "Конец", "Экземпляр", "Ключ", "Активируйте цифровой экземпляр с помощью этого кода.", "Лицензия и сведения об этом издании доступны в Tloque."],
  }
  const [contents, edition, end, copy, key, claim, rights] = rows[language.split("-")[0]] || rows.en
  return { contents, edition, end, copy, key, claim, rights }
}
export interface SheetSide { signature: number; sheet: number; side: "front" | "back"; left: number; right: number }
export function imposeBooklet(count: number, signature: number): { sides: SheetSide[]; paddedPages: number; blanks: number; signatures: number } {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1800 || ![4, 8, 16, 32].includes(signature)) throw new Error("Invalid imposition")
  const paddedPages = Math.ceil(count / 4) * 4, sides: SheetSide[] = []
  let group = 0, sheet = 0
  for (let start = 0; start < paddedPages; start += signature) {
    group++
    const n = Math.min(signature, paddedPages - start)
    for (let s = 0; s < n / 4; s++) {
      sheet++
      sides.push({ signature: group, sheet, side: "front", left: start + n - 2 * s, right: start + 1 + 2 * s })
      sides.push({ signature: group, sheet, side: "back", left: start + 2 + 2 * s, right: start + n - 1 - 2 * s })
    }
  }
  return { sides, paddedPages, blanks: paddedPages - count, signatures: group }
}
