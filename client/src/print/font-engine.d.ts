declare module "fontkit" {
  export interface Font {
    unitsPerEm: number; ascent: number; descent: number; familyName: string
    hasGlyphForCodePoint(cp: number): boolean
    layout(text: string, features?: Record<string, boolean>, script?: string, language?: string, direction?: string): {
      glyphs: { id: number; codePoints: number[]; path: { commands: { command: string; args: number[] }[]; toSVG(): string } }[]
      positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[]
    }
  }
  export function create(bytes: Uint8Array): Font
}
declare module "unicode-properties" { export function getScript(cp: number): string }
declare module "bidi-js" {
  interface Levels { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] }
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): Levels
    getReorderSegments(text: string, levels: Levels): [number, number][]
    getMirroredCharactersMap(text: string, levels: Uint8Array): Map<number, string>
  }
}
