import { create, type Font } from "fontkit"
import bidiFactory from "bidi-js"
import { getScript } from "unicode-properties"
import { PT_MM, type FontMetrics, type FontStyle, type GlyphPath, type TextInk } from "./model"
import { emptyPrintResources, resourceSegments, validatePrintResources, type PrintResources } from "./resources"
import type { PrintFonts } from "./pdfRuntime"

const bidi = bidiFactory()
const ignored = /^[\p{Default_Ignorable_Code_Point}\s]*$/u
const formatting = /^\p{Default_Ignorable_Code_Point}*$/u
const blankGlyph = /^[\p{Default_Ignorable_Code_Point}\s\u2800]*$/u
const decode = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0))
function readFont(data: string): Font {
  const font = create(decode(data))
  if (!font || typeof font.layout !== "function" || !Number.isFinite(font.unitsPerEm) || font.unitsPerEm < 16
    || font.unitsPerEm > 16384 || !Number.isFinite(font.ascent) || !Number.isFinite(font.descent)) throw new Error("customFont")
  return font
}
function outline(commands: { command: string; args: number[] }[], svg: string): GlyphPath {
  const result: GlyphPath = { svg, commands: [] }; let x = 0, y = 0
  for (const { command, args: a } of commands) {
    if (a.some(v => !Number.isFinite(v)) || result.commands.length > 100000) throw new Error("customFont")
    if (command === "moveTo" || command === "lineTo") {
      result.commands.push({ op: command === "moveTo" ? "m" : "l", c: a }); [x, y] = a
    } else if (command === "quadraticCurveTo") {
      result.commands.push({ op: "c", c: [x + (a[0] - x) * 2 / 3, y + (a[1] - y) * 2 / 3,
        a[2] + (a[0] - a[2]) * 2 / 3, a[3] + (a[1] - a[3]) * 2 / 3, a[2], a[3]] }); x = a[2]; y = a[3]
    } else if (command === "bezierCurveTo") { result.commands.push({ op: "c", c: a }); x = a[4]; y = a[5] }
    else if (command === "closePath") result.commands.push({ op: "h", c: [] })
    else throw new Error("customFont")
  }
  return result
}

// Source Serif remains embedded/selectable. Extended runs are shaped once in
// the worker and shared as vector outlines by the preview and every PDF format.
export function unicodeMetrics(base: FontMetrics, fonts: PrintFonts, fallbackData: string, input: PrintResources = emptyPrintResources()): FontMetrics {
  const resources = validatePrintResources(input)
  const primary = Object.fromEntries(Object.entries(fonts).map(([style, data]) => [style, readFont(data)])) as Record<FontStyle, Font>
  const fallback = readFont(fallbackData)
  let extra: Font[]
  try { extra = resources.fonts.map(f => readFont(f.data)) } catch { throw new Error("customFont") }
  const symbols = new Map(resources.symbols.map(s => [s.token, s]))
  const segments = (text: string) => resourceSegments(text, resources.symbols)
  const selection = new Map<string, Font | null>(), paths = new WeakMap<Font, Map<number, GlyphPath>>()
  const needsCache = new Map<string, boolean>()
  const fontFor = (cluster: string, style: FontStyle): Font | null => {
    const key = style + cluster
    if (selection.has(key)) return selection.get(key)!
    const font = [primary[style], ...extra, fallback].find(f => [...cluster].every(c => formatting.test(c) || f.hasGlyphForCodePoint(c.codePointAt(0)!))) || null
    selection.set(key, font); return font
  }
  const needsOutline = (text: string, style: FontStyle) => {
    const key = style + text
    const cached = needsCache.get(key)
    if (cached !== undefined) return cached
    const needs = segments(text).some(c => symbols.has(c) || /[\p{M}\p{Cf}\u{10000}-\u{10ffff}]/u.test(c)
      || [...c].some(ch => !base.hasGlyph(ch, style)))
    if (needsCache.size > 4000) needsCache.clear()
    needsCache.set(key, needs); return needs
  }
  type Run = { text: string; font: Font | null; level: number; script: string; order: number; symbol?: string }
  type Shape = { ink: TextInk[]; width: number; ascent: number; descent: number }
  const cache = new Map<string, Shape>()
  const shape = (text: string, style: FontStyle, direction?: "ltr" | "rtl"): Shape => {
    const key = style + "\0" + direction + "\0" + text
    const cached = cache.get(key)
    if (cached) return cached
    const embedding = bidi.getEmbeddingLevels(text, direction), visual = Array.from({ length: text.length }, (_, i) => i)
    for (const [start, end] of bidi.getReorderSegments(text, embedding)) {
      for (let a = start, b = end; a < b; a++, b--) [visual[a], visual[b]] = [visual[b], visual[a]]
    }
    const order = new Uint32Array(text.length); visual.forEach((logical, i) => { order[logical] = i })
    const mirrors = bidi.getMirroredCharactersMap(text, embedding.levels)
    const runs: Run[] = []; let index = 0
    for (const cluster of segments(text)) {
      const level = embedding.levels[index] || 0, symbol = symbols.has(cluster) ? cluster : undefined
      const font = symbol ? null : fontFor(cluster, style)
      const script = [...cluster].map(c => getScript(c.codePointAt(0)!)).find(s => s !== "Common" && s !== "Inherited") || "Common"
      const last = runs.at(-1)
      let offset = index
      const mirrored = [...cluster].map(c => { const value = mirrors.get(offset) || c; offset += c.length; return value }).join("")
      const position = Math.min(...order.subarray(index, index + cluster.length))
      if (!symbol && last && !last.symbol && last.font === font && last.level === level && (script === last.script || script === "Common")) {
        last.text += mirrored; last.order = Math.min(last.order, position)
      } else runs.push({ text: mirrored, font, level, script, order: position, symbol })
      index += cluster.length
    }
    runs.sort((a, b) => a.order - b.order)
    const ink: TextInk[] = []; let x = 0
    for (const run of runs) {
      if (run.symbol) {
        const image = symbols.get(run.symbol)!.image
        // Inline artwork fits one em vertically and at most three em horizontally.
        const h = Math.min(1, 3 * image.height / image.width), w = h * image.width / image.height
        ink.push({ kind: "image", data: image.data, x, y: -.8 * h, width: w, height: h, sourceWidth: image.width }); x += w + .08
        continue
      }
      if (!run.font) {
        // An ideographic space needs one em even when no installed font maps it.
        // Formatting controls have no visible shape; never draw a .notdef box.
        if (ignored.test(run.text)) { x += [...run.text].reduce((w, c) => w + (formatting.test(c) ? 0 : c === "\u3000" || c === "\t" ? 1 : .25), 0); continue }
        throw new Error("missingGlyph")
      }
      const font = run.font, scale = 1 / font.unitsPerEm
      const layout = font.layout(run.text, { kern: false, rtlm: false }, undefined, undefined, run.level % 2 ? "rtl" : "ltr")
      let pathCache = paths.get(font)
      if (!pathCache) { pathCache = new Map(); paths.set(font, pathCache) }
      layout.glyphs.forEach((glyph, i) => {
        const p = layout.positions[i]
        if (!glyph.id && !ignored.test(String.fromCodePoint(...glyph.codePoints))) throw new Error("missingGlyph")
        let path = pathCache!.get(glyph.id)
        if (!path) { path = outline(glyph.path.commands, glyph.path.toSVG()); pathCache!.set(glyph.id, path) }
        if (path.commands.length) ink.push({ kind: "path", path, x: x + p.xOffset * scale, y: -p.yOffset * scale, scale })
        else if (glyph.codePoints.length && !blankGlyph.test(String.fromCodePoint(...glyph.codePoints))) throw new Error("missingGlyph")
        x += p.xAdvance * scale
      })
    }
    if (!Number.isFinite(x)) throw new Error("customFont")
    let minY = 0, maxY = 0
    for (const item of ink) {
      if (item.kind === "image") { minY = Math.min(minY, item.y); maxY = Math.max(maxY, item.y + item.height) }
      else for (const command of item.path.commands) for (let i = 1; i < command.c.length; i += 2) {
        const y = item.y - command.c[i] * item.scale; minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
    }
    const result = { ink, width: x, ascent: -minY, descent: maxY }
    if (cache.size > 1000) cache.clear()
    cache.set(key, result); return result
  }
  return {
    segments,
    direction(text) { return (bidi.getEmbeddingLevels(text).paragraphs[0]?.level || 0) % 2 ? "rtl" : "ltr" },
    canJustify(text) { return !needsOutline(text, "normal") },
    extents(text, pt, style = "normal") {
      if (!needsOutline(text, style)) return { ascent: pt * PT_MM * .75, descent: pt * PT_MM * .25 }
      const result = shape(text, style), em = pt * PT_MM
      return { ascent: result.ascent * em, descent: result.descent * em }
    },
    width(text, pt, style = "normal", direction) {
      if (!needsOutline(text, style)) return base.width(text, pt, style)
      // Preflight reports unavailable shapes; it must still be possible to compose
      // a cover report when an interior has missing glyphs.
      try { return shape(text, style, direction).width * pt * PT_MM } catch { return base.width(text, pt, style) }
    },
    hasGlyph(cluster, style = "normal") {
      if (symbols.has(cluster) || ignored.test(cluster)) return true
      const font = fontFor(cluster, style)
      if (!font) return false
      try {
        if (/\p{Extended_Pictographic}/u.test(cluster) && /[\u200d\p{Emoji_Modifier}]/u.test(cluster)) {
          const visible = font.layout(cluster).glyphs.filter(g => !ignored.test(String.fromCodePoint(...g.codePoints)))
          if (visible.length !== 1) return false
        }
        shape(cluster, style); return true
      } catch { return false }
    },
    prepare(op) {
      if (!needsOutline(op.text, op.font)) return
      const em = op.pt * PT_MM
      op.ink = shape(op.text, op.font, op.direction).ink.map(item => item.kind === "path"
        ? { ...item, x: op.x + item.x * em, y: op.y + item.y * em, scale: item.scale * em }
        : { ...item, x: op.x + item.x * em, y: op.y + item.y * em, width: item.width * em, height: item.height * em })
    },
  }
}
