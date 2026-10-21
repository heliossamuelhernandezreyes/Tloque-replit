import { useId, useMemo } from "react"
import qrcode from "qrcode-generator"
import { PT_MM, type EditionLayout, type PageOp } from "./model"
import type { CoverLayout, CoverOp } from "./cover"
import { printText } from "./strings"

function Qr({ op }: { op: Extract<PageOp, { kind: "qr" }> }) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, "M"); qr.addData(op.value); qr.make()
    const n = qr.getModuleCount(); let path = ""
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += "M" + (c + 4) + " " + (r + 4) + "h1v1h-1z"
    return { path, n: n + 8 }
  }, [op.value])
  return <svg x={op.x} y={op.y} width={op.size} height={op.size} viewBox={"0 0 " + n + " " + n} aria-hidden="true"><rect width={n} height={n} fill="white" /><path d={path} fill="black" /></svg>
}
function Operation({ op }: { op: CoverOp }) {
  if (op.kind === "image") return <image href={op.data} x={op.x} y={op.y} width={op.width} height={op.height} />
  if (op.kind === "qr") return <Qr op={op} />
  const color = "rgb(" + [op.gray, op.gray, op.gray].join(",") + ")"
  if (op.kind === "rect") return <rect x={op.x} y={op.y} width={op.width} height={op.height} fill={color} />
  if (op.kind === "line") return <line x1={op.x} y1={op.y} x2={op.x2} y2={op.y2} stroke={color} strokeWidth={op.weight} />
  if (op.ink) return <g aria-label={op.text}><title>{op.text}</title>{op.ink.map((item, i) => item.kind === "image"
    ? <image key={i} href={item.data} x={item.x} y={item.y} width={item.width} height={item.height} />
    : <path key={i} d={item.path.svg} fill={color} transform={`translate(${item.x} ${item.y}) scale(${item.scale} ${-item.scale})`} />)}</g>
  return <text x={op.x} y={op.y} fill={color} fontSize={op.pt * PT_MM} fontFamily="TloquePrintSerif" fontWeight={op.font === "bold" ? 700 : 400} fontStyle={op.font === "italic" ? "italic" : "normal"}>
    {op.words ? op.words.map((word, i) => <tspan key={i} x={word.x}>{word.text}</tspan>) : op.text}
  </text>
}
export default function PrintPreview({ interior, cover, page, part, guides, label, coverPage = 0, language = "es" }: { interior: EditionLayout; cover: CoverLayout; page: number; part: "interior" | "cover"; guides: boolean; label: string; coverPage?: number; language?: string }) {
  const clipId = useId().replace(/:/g, ""), t = printText(language)
  const isCover = part === "cover", w = isCover ? cover.width : interior.width, h = isCover ? cover.height : interior.height
  const ops = isCover ? cover.ops : interior.pages[page]?.ops || []
  const s = interior.settings, left = (page + 1) % 2 ? s.inner : s.outer
  if (isCover && s.destination !== "press") {
    const pw = s.paper === "letter" ? 215.9 : 210, ph = s.paper === "letter" ? 279.4 : 297
    const folded = cover.binding === "saddle", kit = cover.binding === "bound"
    const width = folded ? ph : pw, height = folded ? pw : ph
    const panelWidth = cover.trimWidth + (coverPage ? 12 : cover.spine)
    const x = kit ? (width - panelWidth) / 2 : folded ? 10 : 0
    const y = kit ? (height - cover.trimHeight) / 2 : folded ? 10 : 0
    const clipWidth = kit ? cover.trimWidth + (coverPage ? 0 : cover.spine) : width - x * 2
    const clipHeight = kit ? cover.trimHeight : height - y * 2
    const sourceX = kit ? cover.bleed + (coverPage ? 0 : cover.trimWidth) : cover.bleed + (folded || coverPage ? 0 : cover.trimWidth)
    const dx = kit ? x - sourceX : -sourceX, dy = kit ? y - cover.bleed : -cover.bleed
    const fold = x + (coverPage ? cover.trimWidth : cover.spine)
    return <svg className="print-paper" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} data-testid="print-preview" style={{ aspectRatio: width + " / " + height }}>
      <rect width={width} height={height} fill="white" />
      <defs><clipPath id={clipId}><rect x={x} y={y} width={clipWidth} height={clipHeight} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}><g transform={`translate(${dx} ${dy})`}>{cover.ops.map((op, i) => <Operation op={op} key={i} />)}</g></g>
      {kit && <g fontFamily="TloquePrintSerif" textAnchor="middle" fill="#323232">
        <rect x={x} y={y} width={panelWidth} height={cover.trimHeight} fill="none" stroke="#414141" strokeWidth=".2" />
        <line x1={fold} x2={fold} y1={y - 3} y2={y + cover.trimHeight + 3} stroke="#414141" strokeWidth=".2" strokeDasharray="2 1.5" />
        <text x={width / 2} y={y + cover.trimHeight + 10} fontSize={9 * PT_MM}>{t("cut")} / {t("fold")}</text>
        <text x={width / 2} y={y - 7} fontSize={8 * PT_MM}>{cover.trimWidth} × {cover.trimHeight} mm · 100%</text>
        {!!coverPage && <text textAnchor="start" transform={`translate(${x + cover.trimWidth + 4} ${y + cover.trimHeight / 2}) rotate(-90)`} fontSize={7 * PT_MM}>{t("glue")}</text>}
      </g>}
      {folded && <g stroke="#a0a0a0" strokeWidth=".15" strokeDasharray="2 2"><line x1={width / 2} x2={width / 2} y1={3} y2={8} /><line x1={width / 2} x2={width / 2} y1={height - 8} y2={height - 3} /></g>}
      {guides && <rect x={kit ? x : 10} y={kit ? y : 10} width={kit ? panelWidth : width - 20} height={kit ? cover.trimHeight : height - 20} stroke="#a254d0" strokeWidth=".3" strokeDasharray="1 1" fill="none" />}
    </svg>
  }
  return <svg className={"print-paper" + (isCover ? " print-paper-cover" : "")} viewBox={"0 0 " + w + " " + h} role="img" aria-label={label} data-testid="print-preview" style={{ aspectRatio: w + " / " + h }}>
    <rect width={w} height={h} fill="white" />
    {ops.map((op, i) => <Operation op={op} key={i} />)}
    {guides && <g fill="none" stroke="#a254d0" strokeWidth=".3" strokeDasharray="1 1" aria-hidden="true">
      {isCover ? <><rect x={cover.bleed} y={cover.bleed} width={w - 2 * cover.bleed} height={h - 2 * cover.bleed} /><line x1={cover.bleed + cover.trimWidth} x2={cover.bleed + cover.trimWidth} y1={0} y2={h} /><line x1={cover.bleed + cover.trimWidth + cover.spine} x2={cover.bleed + cover.trimWidth + cover.spine} y1={0} y2={h} /></>
        : <rect x={left} y={s.top} width={w - s.inner - s.outer} height={h - s.top - s.bottom} />}
    </g>}
  </svg>
}
