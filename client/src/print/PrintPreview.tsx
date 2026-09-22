import { useMemo } from "react"
import qrcode from "qrcode-generator"
import { PT_MM, type EditionLayout, type PageOp } from "./model"
import type { CoverLayout, CoverOp } from "./cover"

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
export default function PrintPreview({ interior, cover, page, part, guides, label }: { interior: EditionLayout; cover: CoverLayout; page: number; part: "interior" | "cover"; guides: boolean; label: string }) {
  const isCover = part === "cover", w = isCover ? cover.width : interior.width, h = isCover ? cover.height : interior.height
  const ops = isCover ? cover.ops : interior.pages[page]?.ops || []
  const s = interior.settings, left = (page + 1) % 2 ? s.inner : s.outer
  return <svg className={"print-paper" + (isCover ? " print-paper-cover" : "")} viewBox={"0 0 " + w + " " + h} role="img" aria-label={label} data-testid="print-preview" style={{ aspectRatio: w + " / " + h }}>
    <rect width={w} height={h} fill="white" />
    {ops.map((op, i) => <Operation op={op} key={i} />)}
    {guides && <g fill="none" stroke="#a254d0" strokeWidth=".3" strokeDasharray="1 1" aria-hidden="true">
      {isCover ? <><rect x={cover.bleed} y={cover.bleed} width={w - 2 * cover.bleed} height={h - 2 * cover.bleed} /><line x1={cover.bleed + cover.trimWidth} x2={cover.bleed + cover.trimWidth} y1={0} y2={h} /><line x1={cover.bleed + cover.trimWidth + cover.spine} x2={cover.bleed + cover.trimWidth + cover.spine} y1={0} y2={h} /></>
        : <rect x={left} y={s.top} width={w - s.inner - s.outer} height={h - s.top - s.bottom} />}
    </g>}
  </svg>
}
