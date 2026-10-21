import { editionSettings, PRINT_VERSION, type EditionSettings, type PrintBook } from "./model"
import { assertPrintImage, validatePrintResources, type PrintResources } from "./resources"
import type { PrintImage } from "./cover"

export async function manuscriptFingerprint(book: PrintBook): Promise<string> {
  const text = (s?: string) => String(s || "").replace(/\r\n?/g, "\n").normalize("NFC")
  const source = book.chapters?.length ? book.chapters : [{ title: book.title, content: book.content || "" }]
  const value = JSON.stringify({ title: text(book.title), author: text(book.author), language: book.originalLanguage || "", year: book.publicationYear ?? null,
    revision: book.revision ?? null, sourceMetadata: book.sourceMetadata ?? null, chapters: source.map(c => ({ title: text(c.title), content: text(c.content) })) })
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("")
}
export interface EditionProject {
  version: 2; engine: number; book: string; fingerprint: string
  settings: EditionSettings; resources: PrintResources; blurb: string
  art: PrintImage | null; backArt: PrintImage | null
}
export async function createEditionProject(book: PrintBook, settings: EditionSettings, resources: PrintResources, blurb: string, art: PrintImage | null, backArt: PrintImage | null): Promise<EditionProject> {
  // Construct a whitelist. Never serialize props, copy credentials, the whole
  // manuscript, printer calibration or an authenticated URL into this file.
  return { version: 2, engine: PRINT_VERSION, book: String(book.id ?? book.title), fingerprint: await manuscriptFingerprint(book),
    settings: editionSettings(settings), resources: validatePrintResources(resources), blurb, art, backArt }
}
export async function readEditionProject(value: unknown, book: PrintBook): Promise<EditionProject> {
  const p = value as EditionProject
  if (!p || p.version !== 2 || p.engine !== PRINT_VERSION || !p.settings || !p.resources || typeof p.blurb !== "string" || p.blurb.length > 8000) throw new Error("project")
  if (p.book !== String(book.id ?? book.title) || p.fingerprint !== await manuscriptFingerprint(book)) throw new Error("projectMismatch")
  const resources = validatePrintResources(p.resources)
  // Cover images get the same byte/pixel checks as any imported artwork.
  for (const image of [p.art, p.backArt]) if (image !== null) assertPrintImage(image)
  return createEditionProject(book, p.settings, resources, p.blurb, p.art, p.backArt)
}
export const bookSettingsKey = (book: PrintBook) => "tloque_print_book_v2:" + encodeURIComponent(String(book.id ?? book.title))
export function initialEditionSettings(book: PrintBook, local: Pick<Storage, "getItem">, destination?: EditionSettings["destination"]): EditionSettings {
  let value: Partial<EditionSettings> = {}
  try { value = JSON.parse(local.getItem(bookSettingsKey(book)) || "{}") || {} } catch { /* fresh design */ }
  // Interpretation is scoped to this work, never inherited from another book.
  return editionSettings({ ...value, ...(destination ? { destination, recto: destination === "press" } : {}), spineMm: 0,
    textMode: value.textMode || (String(book.id).startsWith("gutenberg-") ? "reflow" : "paragraphs") })
}
