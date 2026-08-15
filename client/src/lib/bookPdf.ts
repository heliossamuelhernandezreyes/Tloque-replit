// Motor de PDF de Tloque — genera el libro en tres vestidos:
//  · "a5":      formato editorial con márgenes espejo (imprenta/encuadernación)
//  · "letter":  carta vertical, márgenes uniformes (cualquier impresora)
//  · "booklet": FOLLETO — hojas carta apaisadas con dos páginas por cara,
//               barajadas (imposición) para doblar el fajo por la mitad,
//               engrapar en el doblez y obtener un librito de media carta.
//
// El folleto funciona grabando primero las páginas "lógicas" (media carta)
// con un grabador que imita a jsPDF, y luego reproduciéndolas sobre las
// hojas físicas en el orden mágico: F[N,1] T[2,N-1] F[N-2,3] T[4,N-3]…

export type PdfFormat = "a5" | "letter" | "booklet"
export interface PdfCopy { folio: string; key: string }

// Carga diferida, pero desde dependencias fijadas en el build. Así la
// generación de ejemplares no ejecuta JavaScript remoto en tiempo de uso.
async function ensurePdfRuntime(withQr: boolean): Promise<void> {
  if (!(window as any).jspdf?.jsPDF) {
    const { jsPDF } = await import("jspdf")
    ;(window as any).jspdf = { jsPDF }
  }
  if (withQr && !(window as any).qrcode) {
    const module = await import("qrcode-generator")
    ;(window as any).qrcode = module.default
  }
}

async function coverToDataURL(book: any): Promise<string | null> {
  const src = book?.coverUrl
  if (!src) return null
  if (src.startsWith("data:")) return src
  try {
    const r = await fetch(src)
    const b = await r.blob()
    return await new Promise<string>((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result as string)
      fr.onerror = () => rej(new Error("read"))
      fr.readAsDataURL(b)
    })
  } catch { return null }   // CORS u offline: portada tipográfica
}

// ── Métricas por formato ─────────────────────────────────────
interface Metrics {
  INNER: number; OUTER: number; TOP: number; BOTTOM: number
  LH: number; BODY_PT: number; mirror: boolean
}
const M_A5:     Metrics = { INNER: 20, OUTER: 14, TOP: 18, BOTTOM: 18, LH: 5.4, BODY_PT: 10.5, mirror: true }
const M_LETTER: Metrics = { INNER: 20, OUTER: 20, TOP: 22, BOTTOM: 22, LH: 6.6, BODY_PT: 11.5, mirror: false }
// El folleto es media carta (139.7×215.9): casi A5, mismas métricas espejo
const M_BOOKLET: Metrics = { ...M_A5 }

// Paleta
const GOLD:  [number, number, number] = [180, 130, 30]
const DARK:  [number, number, number] = [20, 18, 24]
const CREAM: [number, number, number] = [250, 246, 238]
const INK:   [number, number, number] = [45, 38, 30]
const WARM:  [number, number, number] = [150, 135, 110]
const LIGHT: [number, number, number] = [240, 235, 220]

// ── El pintor: dibuja el libro completo sobre un "doc" ───────
// (doc puede ser el jsPDF real o el grabador del folleto)
function paint(
  doc: any, M: Metrics,
  ctx: { book: any; t: (k: string) => string; copy?: PdfCopy; cover: string | null },
) {
  const { book, t, copy, cover } = ctx
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const TW = PW - M.INNER - M.OUTER
  const INDENT = "     "

  const leftOf = (page: number) =>
    M.mirror ? (page % 2 === 1 ? M.INNER : M.OUTER) : M.INNER

  let bodyStartPage = 0
  function newBodyPage(): number {
    doc.addPage()
    const page = doc.getCurrentPageInfo().pageNumber
    doc.setFillColor(...CREAM); doc.rect(0, 0, PW, PH, "F")
    const header = (page % 2 === 0 ? book.author : book.title).toUpperCase()
    doc.setTextColor(...WARM); doc.setFontSize(7); doc.setFont("times", "normal")
    doc.text(header.slice(0, 60), PW / 2, M.TOP - 7, { align: "center" })
    doc.setDrawColor(...WARM); doc.setLineWidth(0.1)
    doc.line(leftOf(page), M.TOP - 4.5, leftOf(page) + TW, M.TOP - 4.5)
    return M.TOP + 2
  }

  function stampFolio() {
    const page = doc.getCurrentPageInfo().pageNumber
    const shown = page - bodyStartPage + 1
    if (shown < 1) return
    doc.setTextColor(...WARM); doc.setFontSize(8); doc.setFont("times", "normal")
    doc.text(String(shown), PW / 2, PH - 9, { align: "center" })
  }

  // ── PORTADA ──
  doc.setFillColor(...DARK); doc.rect(0, 0, PW, PH, "F")
  let y = 0
  let coverDrawn = false
  if (cover) {
    const iw = PW * (copy ? 0.44 : 0.52), ih = iw * 1.5
    const fmt = cover.includes("image/png") ? "PNG" : "JPEG"
    try {
      doc.addImage(cover, fmt, (PW - iw) / 2, 22, iw, ih)
      coverDrawn = true
      y = 22 + ih + 12
    } catch { /* formato no soportado: portada tipográfica */ }
  }
  if (!coverDrawn) {
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    doc.line(M.INNER, 24, PW - M.OUTER, 24)
    y = 44
  }
  doc.setTextColor(...GOLD); doc.setFontSize(coverDrawn ? 15 : 19); doc.setFont("times", "bold")
  const titleLines = doc.splitTextToSize(book.title, TW)
  doc.text(titleLines, PW / 2, y, { align: "center" })
  y += titleLines.length * (coverDrawn ? 7 : 9) + 4
  doc.setTextColor(...LIGHT); doc.setFontSize(11); doc.setFont("times", "italic")
  doc.text(book.author, PW / 2, y, { align: "center" })

  // QR del ejemplar (esquina inferior izquierda de la portada)
  if (copy) {
    const qrData = `${window.location.origin}/claim/${copy.folio}`
    const qr = (window as any).qrcode(0, "M")
    qr.addData(qrData); qr.make()
    const n = qr.getModuleCount()
    const SIZE = 26, QUIET = 2.5
    const px = M.INNER
    const py = PH - 30 - SIZE - QUIET * 2
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(px, py, SIZE + QUIET * 2, SIZE + QUIET * 2, 1.5, 1.5, "F")
    doc.setFillColor(15, 15, 18)
    const mod = SIZE / n
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) doc.rect(px + QUIET + c * mod, py + QUIET + r * mod, mod, mod, "F")
    }
    doc.setTextColor(...GOLD); doc.setFontSize(7); doc.setFont("times", "normal")
    doc.text(copy.folio, px + (SIZE + QUIET * 2) / 2, py + SIZE + QUIET * 2 + 4, { align: "center" })
  }

  doc.setDrawColor(...GOLD); doc.setLineWidth(0.3)
  doc.line(PW / 2 - 12, PH - 24, PW / 2 + 12, PH - 24)
  doc.setTextColor(...WARM); doc.setFontSize(7.5); doc.setFont("times", "normal")
  doc.text("TLOQUE", PW / 2, PH - 17, { align: "center" })

  // ── PÁGINA LEGAL ──
  doc.addPage()
  doc.setFillColor(...CREAM); doc.rect(0, 0, PW, PH, "F")
  doc.setTextColor(...INK); doc.setFontSize(10); doc.setFont("times", "normal")
  doc.text(book.title, PW / 2, PH * 0.40, { align: "center", maxWidth: TW })
  doc.setFontSize(9); doc.setFont("times", "italic")
  doc.text(book.author, PW / 2, PH * 0.40 + 8, { align: "center" })
  doc.setTextColor(...WARM); doc.setFontSize(7.5); doc.setFont("times", "normal")
  const year = book.publicationYear ? String(book.publicationYear) : String(new Date().getFullYear())
  const legal = book.isClassic
    ? `${t("domainPublic")} · ${year}`
    : t("pdfRights").replace("{year}", year).replace("{author}", book.author)
  doc.text(legal, PW / 2, PH * 0.40 + 20, { align: "center", maxWidth: TW })
  doc.text(t("pdfEdition"), PW / 2, PH * 0.40 + 26, { align: "center" })

  if (copy) {
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.2)
    doc.line(PW / 2 - 20, PH * 0.40 + 36, PW / 2 + 20, PH * 0.40 + 36)
    doc.setTextColor(...INK); doc.setFontSize(9); doc.setFont("times", "bold")
    doc.text(`${t("pdfCopyLabel")} ${copy.folio}`, PW / 2, PH * 0.40 + 44, { align: "center" })
    doc.setFont("times", "normal")
    doc.text(`${t("pdfKeyLabel")}: ${copy.key}`, PW / 2, PH * 0.40 + 51, { align: "center" })
    doc.setTextColor(...WARM); doc.setFontSize(7.5)
    doc.text(t("pdfVerifyHint"), PW / 2, PH * 0.40 + 58, { align: "center", maxWidth: TW * 0.85 })

    // El fragmento mantiene la clave fuera de logs de servidor y Referer.
    // La pantalla de reclamo lo consume y limpia la URL de inmediato.
    const qrIn = (window as any).qrcode(0, "M")
    qrIn.addData(`${window.location.origin}/claim/${copy.folio}#key=${encodeURIComponent(copy.key)}`)
    qrIn.make()
    const nIn = qrIn.getModuleCount()
    const S_IN = 16, Q_IN = 2
    const pxIn = PW / 2 - (S_IN + Q_IN * 2) / 2
    const pyIn = PH * 0.40 + 63
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(pxIn, pyIn, S_IN + Q_IN * 2, S_IN + Q_IN * 2, 1.2, 1.2, "F")
    doc.setFillColor(15, 15, 18)
    const mIn = S_IN / nIn
    for (let r = 0; r < nIn; r++) for (let c = 0; c < nIn; c++) {
      if (qrIn.isDark(r, c)) doc.rect(pxIn + Q_IN + c * mIn, pyIn + Q_IN + r * mIn, mIn, mIn, "F")
    }
    doc.setTextColor(...WARM); doc.setFontSize(6.5)
    doc.text(t("pdfInnerQrHint"), PW / 2, pyIn + S_IN + Q_IN * 2 + 4.5, { align: "center", maxWidth: TW * 0.8 })
  }

  // ── CAPÍTULOS ──
  const chapters = book.chapters?.length
    ? book.chapters
    : [{ title: book.title, content: book.content || "" }]
  const many = chapters.length > 1

  bodyStartPage = doc.getCurrentPageInfo().pageNumber + 1

  chapters.forEach((chapter: any, ci: number) => {
    y = newBodyPage()
    y = PH * 0.24
    if (many) {
      doc.setTextColor(...WARM); doc.setFontSize(9); doc.setFont("times", "normal")
      doc.text(`${ci + 1}`, PW / 2, y - 10, { align: "center" })
    }
    const chTitle = chapter.title && chapter.title !== book.title ? chapter.title : (many ? "" : book.title)
    if (chTitle) {
      doc.setTextColor(...INK); doc.setFontSize(13); doc.setFont("times", "bold")
      const chLines = doc.splitTextToSize(chTitle, TW * 0.9)
      doc.text(chLines, PW / 2, y, { align: "center" })
      y += chLines.length * 6.5
    }
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.3)
    doc.line(PW / 2 - 8, y + 3, PW / 2 + 8, y + 3)
    y += 12

    doc.setTextColor(...INK); doc.setFontSize(M.BODY_PT); doc.setFont("times", "normal")
    const paragraphs = (chapter.content || "").split("\n").map((p: string) => p.trim()).filter(Boolean)
    paragraphs.forEach((para: string, pi: number) => {
      const text = pi === 0 ? para : INDENT + para
      const lines = doc.splitTextToSize(text, TW)
      for (const line of lines) {
        if (y + M.LH > PH - M.BOTTOM) {
          stampFolio()
          y = newBodyPage()
          doc.setTextColor(...INK); doc.setFontSize(M.BODY_PT); doc.setFont("times", "normal")
        }
        doc.text(line, leftOf(doc.getCurrentPageInfo().pageNumber), y)
        y += M.LH
      }
    })
    stampFolio()
  })

  // ── COLOFÓN ──
  doc.setTextColor(...WARM); doc.setFontSize(9); doc.setFont("times", "italic")
  const finY = Math.min(y + 16, PH - M.BOTTOM - 10)
  doc.text(t("pdfEnd"), PW / 2, finY, { align: "center" })
}

// ── Grabador de páginas lógicas (para el folleto) ────────────
// Imita la superficie de jsPDF que usa `paint`; guarda operaciones
// por página. Delega la MEDICIÓN de texto al jsPDF real (fuentes).
type Op = { fn: string; args: any[] }

function makeRecorder(realDoc: any, w: number, h: number) {
  const pages: Op[][] = [[]]
  let curFont = { family: "times", style: "normal" }
  let curSize = 12
  const push = (fn: string, ...args: any[]) => pages[pages.length - 1].push({ fn, args })
  return {
    pages,
    internal: { pageSize: { getWidth: () => w, getHeight: () => h } },
    addPage() { pages.push([]) },
    getCurrentPageInfo() { return { pageNumber: pages.length } },
    splitTextToSize(txt: string, width: number) {
      realDoc.setFont(curFont.family, curFont.style)
      realDoc.setFontSize(curSize)
      return realDoc.splitTextToSize(txt, width)
    },
    setFont(f: string, s: string) { curFont = { family: f, style: s }; push("setFont", f, s) },
    setFontSize(n: number) { curSize = n; push("setFontSize", n) },
    setFillColor(...a: any[]) { push("setFillColor", ...a) },
    setDrawColor(...a: any[]) { push("setDrawColor", ...a) },
    setTextColor(...a: any[]) { push("setTextColor", ...a) },
    setLineWidth(n: number) { push("setLineWidth", n) },
    rect(...a: any[]) { push("rect", ...a) },
    roundedRect(...a: any[]) { push("roundedRect", ...a) },
    line(...a: any[]) { push("line", ...a) },
    text(...a: any[]) { push("text", ...a) },
    addImage(...a: any[]) { push("addImage", ...a) },
  }
}

// Reproduce las ops de una página lógica sobre el doc real, desplazada dx
function replay(realDoc: any, ops: Op[], dx: number) {
  for (const { fn, args } of ops) {
    const a = [...args]
    if (fn === "text" || fn === "rect" || fn === "roundedRect" || fn === "addImage") {
      a[fn === "text" ? 1 : fn === "addImage" ? 2 : 0] += dx
    } else if (fn === "line") {
      a[0] += dx; a[2] += dx
    }
    ;(realDoc as any)[fn](...a)
  }
}

// Arma el folleto: relleno a múltiplo de 4, contraportada, imposición.
// Dos modos automáticos:
//  · "saddle" (≤32 págs): UN fajo — F[N,1] T[2,N-1]… doblar todo y engrapar.
//  · "signatures" (>32): PLIEGOS de una hoja (4 págs c/u) — hoja k:
//    F[4k+4, 4k+1] T[4k+2, 4k+3]. Se doblan por separado, se apilan en
//    orden y se pegan por el canto (un libro gordo no se puede engrapar).
const SADDLE_MAX = 32

function buildBooklet(realDoc: any, pages: Op[][], halfW: number, fullH: number) {
  // Rellenar a múltiplo de 4 con páginas crema
  const filler: Op[] = [
    { fn: "setFillColor", args: CREAM as any },
    { fn: "rect", args: [0, 0, halfW, fullH, "F"] },
  ]
  let padded = 0
  while (pages.length % 4 !== 0) { pages.push([...filler]); padded++ }
  // Si hubo relleno, la última página (contraportada física) va oscura con la marca
  if (padded > 0) {
    pages[pages.length - 1] = [
      { fn: "setFillColor", args: DARK as any },
      { fn: "rect", args: [0, 0, halfW, fullH, "F"] },
      { fn: "setTextColor", args: GOLD as any },
      { fn: "setFontSize", args: [9] },
      { fn: "setFont", args: ["times", "normal"] },
      { fn: "text", args: ["TLOQUE", halfW / 2, fullH / 2, { align: "center" }] },
    ]
  }
  const N = pages.length
  const mode: "saddle" | "signatures" = N <= SADDLE_MAX ? "saddle" : "signatures"
  const sheets = N / 4

  for (let s = 0; s < sheets; s++) {
    const front = mode === "saddle"
      ? [N - 2 * s, 1 + 2 * s]          // fajo único
      : [4 * s + 4, 4 * s + 1]          // pliego independiente
    const back = mode === "saddle"
      ? [2 + 2 * s, N - 1 - 2 * s]
      : [4 * s + 2, 4 * s + 3]
    if (s > 0) realDoc.addPage()
    replay(realDoc, pages[front[0] - 1], 0)
    replay(realDoc, pages[front[1] - 1], halfW)
    realDoc.addPage()
    replay(realDoc, pages[back[0] - 1], 0)
    replay(realDoc, pages[back[1] - 1], halfW)
  }
  return { logicalPages: N, physicalPages: sheets * 2, padded, mode }
}

// ── KIT DE PORTADA RECORTABLE (opalina) ──────────────────────
// Dos hojas carta VERTICALES para imprimir en cartulina:
//  · Hoja 1: [LOMO | PORTADA] a altura completa + tira SEPARADOR abajo
//  · Hoja 2: [CONTRAPORTADA | zona de pegado]
// El panel mide 218mm de alto — 2mm más que el interior de media carta
// (215.9), para que la cubierta quede al ras o con una ceja de 1mm por
// lado tras el recorte. Se recorta por la línea continua, se dobla por
// las punteadas, y el lomo de la hoja 1 se pega sobre la zona marcada
// de la hoja 2: queda [contraportada|lomo|portada]. La franja del lomo
// (35mm) da holgura: se dobla donde el grosor real del libro lo pida y
// el excedente, oscuro sobre oscuro, se funde invisible.
export async function generateCoverKit(
  book: any,
  t: (k: string) => string,
  copy?: PdfCopy,
): Promise<void> {
  await ensurePdfRuntime(!!copy)
  const { jsPDF } = (window as any).jspdf
  const cover = await coverToDataURL(book)
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" })
  // Carta vertical: 215.9 × 279.4

  const Y0 = 8, Y1 = 226                 // panel: 218mm de alto (> 215.9 del interior)
  const dash = (on: boolean) => {
    if (typeof doc.setLineDashPattern === "function") doc.setLineDashPattern(on ? [2, 1.6] : [], 0)
  }
  const cutRect = (x0: number, y0: number, x1: number, y1: number) => {
    dash(false)
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.15)
    doc.rect(x0, y0, x1 - x0, y1 - y0)
  }
  const foldLine = (x: number) => {
    dash(true)
    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.12)
    doc.line(x, Y0, x, Y1)
    dash(false)
  }
  const legend = (y: number) => {
    doc.setTextColor(...WARM); doc.setFontSize(6); doc.setFont("times", "normal")
    doc.text(`${t("foldWord")} · · ·     ${t("cutWord")} ———`, 100, y, { align: "center" })
  }

  // ═══ HOJA 1: lomo (8–43) · portada (43–193) · tira separador abajo ═══
  // Lomo (franja de ajuste: se dobla según el grosor real)
  doc.setFillColor(...DARK); doc.rect(8, Y0, 35, Y1 - Y0, "F")
  doc.setTextColor(...GOLD); doc.setFontSize(11); doc.setFont("times", "bold")
  doc.text(String(book.title).slice(0, 52), 28, Y1 - 12, { angle: 90 })
  doc.setFontSize(6.5); doc.setFont("times", "normal"); doc.setTextColor(...WARM)
  doc.text("TLOQUE", 25.5, Y1 - 3.5, { align: "center" })

  // Panel de portada: banda editorial + arte + QR
  doc.setFillColor(...DARK); doc.rect(43, Y0, 150, Y1 - Y0, "F")
  doc.setFillColor(28, 25, 34); doc.rect(43, Y0, 150, 34, "F")
  doc.setTextColor(...GOLD); doc.setFontSize(15); doc.setFont("times", "bold")
  const tl = doc.splitTextToSize(book.title, 138)
  doc.text(tl.slice(0, 2), 118, 19, { align: "center" })
  doc.setTextColor(...LIGHT); doc.setFontSize(9.5); doc.setFont("times", "italic")
  doc.text(book.author, 118, 19 + Math.min(tl.length, 2) * 7 + 2, { align: "center" })
  if (cover) {
    const areaY = 44, areaH = Y1 - areaY - 2          // 180mm de alto
    const ih = areaH
    const iw = Math.min(146, ih * (2 / 3))            // proporción 2:3
    const fmt = cover.includes("image/png") ? "PNG" : "JPEG"
    try { doc.addImage(cover, fmt, 43 + (150 - iw) / 2, areaY, iw, ih) } catch { /* sin arte */ }
  } else {
    doc.setTextColor(...GOLD); doc.setFontSize(26); doc.setFont("times", "normal")
    doc.text("\u2726", 118, 130, { align: "center" })
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.3)
    doc.line(98, 138, 138, 138)
  }
  if (copy) {
    const qr = (window as any).qrcode(0, "M")
    qr.addData(`${window.location.origin}/claim/${copy.folio}`); qr.make()
    const n = qr.getModuleCount(), SZ = 24, Q = 2.5
    const px = 49, py = Y1 - 10 - SZ - Q * 2          // esquina inferior izquierda del panel
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(px, py, SZ + Q * 2, SZ + Q * 2, 1.5, 1.5, "F")
    doc.setFillColor(15, 15, 18)
    const mod = SZ / n
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) doc.rect(px + Q + c * mod, py + Q + r * mod, mod, mod, "F")
    }
    doc.setTextColor(...GOLD); doc.setFontSize(6.5); doc.setFont("times", "normal")
    doc.text(copy.folio, px + (SZ + Q * 2) / 2, py + SZ + Q * 2 + 3.5, { align: "center" })
  }
  // Marca de referencia: ancho del interior estándar (media carta)
  dash(true)
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.1)
  doc.line(184.7, Y0, 184.7, Y1)
  dash(false)
  doc.setTextColor(...WARM); doc.setFontSize(5)
  doc.text(t("halfLetterMark"), 186.3, 20, { angle: 90 })

  // Tira SEPARADOR (franja inferior sobrante — recortable aparte)
  doc.setFillColor(...DARK); doc.rect(8, 232, 185, 42, "F")
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.3)
  doc.line(20, 253, 181, 253)
  doc.setTextColor(...GOLD); doc.setFontSize(12); doc.setFont("times", "bold")
  doc.text("TLOQUE", 100, 247, { align: "center" })
  doc.setFontSize(11); doc.text("\u2726", 100, 262, { align: "center" })
  doc.setTextColor(...LIGHT); doc.setFontSize(7.5); doc.setFont("times", "italic")
  doc.text(String(book.title).slice(0, 60), 100, 269, { align: "center" })

  cutRect(8, Y0, 193, Y1); foldLine(43)
  cutRect(8, 232, 193, 274)
  legend(278)

  // ═══ HOJA 2: contraportada (8–158) · zona de pegado (158–193) ═══
  doc.addPage()
  doc.setFillColor(...DARK); doc.rect(8, Y0, 150, Y1 - Y0, "F")
  // Si la obra trae contraportada (normal o premium), va a sangre del panel
  const backArt = String(book.backCoverUrl || "")
  let backDrawn = false
  if (backArt) {
    const bFmt = backArt.includes("image/png") ? "PNG" : "JPEG"
    try { doc.addImage(backArt, bFmt, 8, Y0, 150, Y1 - Y0); backDrawn = true } catch { /* arte ilegible */ }
  }
  const synopsis = String(book.synopsis || t("synopsisFallback")).slice(0, 620)
  if (backDrawn) {
    // Placa central: la sinopsis respira sobre el arte
    doc.setFillColor(...DARK); doc.rect(26, 64, 114, 110, "F")
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.25); doc.rect(26, 64, 114, 110)
    doc.setTextColor(...GOLD); doc.setFontSize(12); doc.setFont("times", "normal")
    doc.text("\u2726", 83, 76, { align: "center" })
    doc.setTextColor(...LIGHT); doc.setFontSize(9.5); doc.setFont("times", "italic")
    const sLines = doc.splitTextToSize(synopsis, 100)
    const maxLines = 12
    const shown = sLines.slice(0, maxLines)
    const startY = 86 + Math.max(0, ((maxLines - shown.length) * 5.2) / 2)
    doc.text(shown, 83, startY, { align: "center" })
    if (copy) {
      doc.setTextColor(...GOLD); doc.setFontSize(7); doc.setFont("times", "normal")
      doc.text(copy.folio, 83, 158, { align: "center" })
    }
    doc.setTextColor(...WARM); doc.setFontSize(7); doc.setFont("times", "normal")
    doc.text("TLOQUE", 83, 166, { align: "center" })
  } else {
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.25)
    doc.rect(16, 16, 134, Y1 - Y0 - 16)
    doc.setTextColor(...GOLD); doc.setFontSize(13); doc.setFont("times", "normal")
    doc.text("\u2726", 83, 34, { align: "center" })
    // Sinopsis centrada, formato clásico
    doc.setTextColor(...LIGHT); doc.setFontSize(10); doc.setFont("times", "italic")
    const sLines = doc.splitTextToSize(synopsis, 116)
    const maxLines = Math.floor((Y1 - 54 - 32) / 5.2)
    const shown = sLines.slice(0, maxLines)
    const startY = 54 + Math.max(0, ((maxLines - shown.length) * 5.2) / 2)
    doc.text(shown, 83, startY, { align: "center" })
    if (copy) {
      doc.setTextColor(...GOLD); doc.setFontSize(7); doc.setFont("times", "normal")
      doc.text(copy.folio, 83, Y1 - 22, { align: "center" })
    }
    doc.setTextColor(...WARM); doc.setFontSize(7); doc.setFont("times", "normal")
    doc.text("TLOQUE", 83, Y1 - 13, { align: "center" })
  }
  // Zona de pegado (el lomo de la hoja 1 se pega encima)
  dash(true)
  doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.15)
  doc.rect(159.5, Y0 + 1.5, 32, Y1 - Y0 - 3)
  dash(false)
  doc.setTextColor(...WARM); doc.setFontSize(8); doc.setFont("times", "normal")
  doc.text(t("glueHere"), 177, (Y0 + Y1) / 2 + 12, { angle: 90 })

  cutRect(8, Y0, 193, Y1); foldLine(158)
  legend(234)

  const cleanTitle = book.title.replace(/[\/*?:"<>|]/g, "").trim()
  doc.save(`${cleanTitle} (portada).pdf`)
}

// ── Punto de entrada ─────────────────────────────────────────
export async function generateBookPdf(
  book: any,
  t: (k: string) => string,
  copy?: PdfCopy,
  opts?: { format?: PdfFormat },
): Promise<{ logicalPages: number; physicalPages: number }> {
  const format: PdfFormat = opts?.format || "a5"

  await ensurePdfRuntime(!!copy)
  const { jsPDF } = (window as any).jspdf
  const cover = await coverToDataURL(book)
  const cleanTitle = book.title.replace(/[\/*?:"<>|]/g, "").trim()

  if (format === "booklet") {
    // Hojas carta APAISADAS; páginas lógicas de media carta
    const realDoc = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape" })
    const halfW = realDoc.internal.pageSize.getWidth() / 2   // 139.7
    const fullH = realDoc.internal.pageSize.getHeight()      // 215.9
    const rec = makeRecorder(realDoc, halfW, fullH)
    paint(rec, M_BOOKLET, { book, t, copy, cover })
    const info = buildBooklet(realDoc, rec.pages, halfW, fullH)
    realDoc.save(`${cleanTitle} (folleto).pdf`)
    return info
  }

  const doc = new jsPDF({ unit: "mm", format, orientation: "portrait" })
  paint(doc, format === "letter" ? M_LETTER : M_A5, { book, t, copy, cover })
  const n = doc.getCurrentPageInfo().pageNumber
  doc.save(`${cleanTitle}.pdf`)
  return { logicalPages: n, physicalPages: n }
}
