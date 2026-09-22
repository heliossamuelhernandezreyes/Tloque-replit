import type { PrintImage } from "./cover"

export interface PrintFontFile { id: string; name: string; data: string }
export interface PrintSymbol { id: string; token: string; image: PrintImage }
export interface PrintIllustration { id: string; chapter: number; afterParagraph: number; widthPercent: number; caption: string; image: PrintImage }
export interface PrintResources { version: 1; fonts: PrintFontFile[]; symbols: PrintSymbol[]; illustrations: PrintIllustration[] }
export const emptyPrintResources = (): PrintResources => ({ version: 1, fonts: [], symbols: [], illustrations: [] })
export const graphemes = (text: string): string[] => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), s => s.segment)
export const validSymbolToken = (token: string) => token.length <= 64 && !/[\s\p{Cc}\p{Cs}]/u.test(token) && !/^\p{Cf}+$/u.test(token)
  && (graphemes(token).length === 1 || /^\[\[[\p{L}\p{N}_-]{1,40}\]\]$/u.test(token))

// Imported resources and worker messages get the same limits as file pickers.
// Never persist font bytes, artwork, manuscripts or copy keys in localStorage.
export function validatePrintResources(value: unknown): PrintResources {
  const r = value as PrintResources
  if (!r || r.version !== 1 || !Array.isArray(r.fonts) || !Array.isArray(r.symbols) || !Array.isArray(r.illustrations)
    || r.fonts.length > 8 || r.symbols.length > 64 || r.illustrations.length > 100) throw new Error("resources")
  let bytes = 0
  const ids = new Set<string>(), tokens = new Set<string>()
  const id = (v: { id: string }) => { if (!v || typeof v.id !== "string" || !v.id || v.id.length > 100 || ids.has(v.id)) throw new Error("resources"); ids.add(v.id) }
  const image = (i: PrintImage) => {
    if (!i || typeof i.data !== "string" || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(i.data)
      || i.data.length > 18_000_000 || !Number.isSafeInteger(i.width) || !Number.isSafeInteger(i.height)
      || i.width < 1 || i.height < 1 || i.width * i.height > 32_000_000) throw new Error("resources")
    bytes += i.data.length
  }
  r.fonts.forEach(f => {
    id(f)
    if (typeof f.name !== "string" || f.name.length > 200 || typeof f.data !== "string" || f.data.length < 1000
      || f.data.length > 32_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)) throw new Error("resources")
    bytes += f.data.length
  })
  r.symbols.forEach(s => {
    id(s)
    if (typeof s.token !== "string" || s.token !== s.token.normalize("NFC") || !validSymbolToken(s.token) || tokens.has(s.token)) throw new Error("resources")
    tokens.add(s.token); image(s.image)
  })
  r.illustrations.forEach(i => {
    id(i); image(i.image)
    if (!Number.isSafeInteger(i.chapter) || i.chapter < 0 || i.chapter >= 500 || !Number.isSafeInteger(i.afterParagraph) || i.afterParagraph < 0
      || !Number.isFinite(i.widthPercent) || i.widthPercent < 10 || i.widthPercent > 100 || typeof i.caption !== "string" || i.caption.length > 500) throw new Error("resources")
  })
  if (bytes > 64_000_000) throw new Error("resources")
  return r
}

export function resourceSegments(text: string, symbols: PrintSymbol[]): string[] {
  if (!symbols.length) return graphemes(text)
  const tokens = symbols.map(s => s.token).sort((a, b) => b.length - a.length)
  const parts: string[] = []; let start = 0, cursor = 0
  while (cursor < text.length) {
    const token = tokens.find(t => text.startsWith(t, cursor))
    if (token) {
      if (cursor > start) parts.push(...graphemes(text.slice(start, cursor)))
      parts.push(token); cursor += token.length; start = cursor
    } else cursor += String.fromCodePoint(text.codePointAt(cursor)!).length
  }
  if (start < text.length) parts.push(...graphemes(text.slice(start)))
  return parts
}
