import regular from "./assets/SourceSerif4-Regular.ttf?url"
import bold from "./assets/SourceSerif4-Bold.ttf?url"
import italic from "./assets/SourceSerif4-It.ttf?url"
import type { PrintFonts } from "./pdfRuntime"

export const fontUrls = { normal: regular, bold, italic }
let loaded: Promise<PrintFonts> | undefined
export function loadPrintFonts(): Promise<PrintFonts> {
  if (!loaded) loaded = Promise.all(Object.entries(fontUrls).map(async ([style, url]) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error("fonts")
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 1000 || bytes.length > 2_000_000) throw new Error("fonts")
    let binary = ""
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return [style, btoa(binary)]
  })).then(entries => Object.fromEntries(entries) as PrintFonts).catch(error => { loaded = undefined; throw error })
  return loaded
}
