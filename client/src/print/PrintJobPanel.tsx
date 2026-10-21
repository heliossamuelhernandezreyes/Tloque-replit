import { useEffect, useMemo, useState } from "react"
import { Download } from "lucide-react"
import type { EditionLayout } from "./model"
import { physicalSides, type PrinterProfile, type PrintSelection } from "./homeJob"
import { homeText } from "./homeStrings"
import type { ExportKind } from "./print.worker"
import { NumberField } from "./controls"

export default function PrintJobPanel({ layout, profile, calibrated, language, disabled, onProfile, onCalibrated, onExport }: {
  layout: EditionLayout; profile: PrinterProfile; calibrated: boolean; language: string; disabled: boolean
  onProfile: (profile: PrinterProfile) => void; onCalibrated: (checked: boolean) => void
  onExport: (kind: ExportKind, selection?: PrintSelection) => void
}) {
  const t = homeText(language), booklet = layout.settings.destination === "booklet", kind = booklet ? "booklet" : "interior"
  const [group, setGroup] = useState(0), [sheet, setSheet] = useState(0)
  useEffect(() => { setGroup(0); setSheet(0) }, [layout])
  const sides = useMemo(() => physicalSides(layout), [layout])
  const groups = [...new Set(sides.map(s => s.signature))]
  const sheets = [...new Set(sides.filter(s => !group || s.signature === group).map(s => s.sheet))]
  const selection: PrintSelection = { ...(group ? { signature: group } : {}), ...(sheet ? { sheet } : {}) }
  const update = (patch: Partial<PrinterProfile>) => onProfile({ ...profile, ...patch })
  return <div className="print-job-panel">
    <label className="print-field"><span>{t("method")}</span><select aria-label={t("method")} value={profile.duplex} onChange={e => update({ duplex: e.target.value as PrinterProfile["duplex"] })}><option value="auto">{t("auto")}</option><option value="manual">{t("manual")}</option></select></label>
    <details className="print-details print-calibration"><summary>{t("calibration")}</summary>
      <p className="print-note">{t(profile.duplex === "manual" ? "calibrationHint" : "calibrationAutoHint")}</p>
      {profile.duplex === "auto" ? <button className="print-secondary" disabled={disabled} onClick={() => onExport("calibrationAuto")}><Download />{t("calibrationAuto")}</button> : <>
        <button className="print-secondary" disabled={disabled} onClick={() => onExport("calibrationFront")}><Download />{t("calibrationFront")}</button>
        <button className="print-secondary" disabled={disabled} onClick={() => onExport("calibrationBack")}><Download />{t("calibrationBack")}</button>
        <p className="print-note">{t("calibrationCheck")}</p>
        {(["reverseBacks", "rotateBacks"] as const).map(key => <label className="print-toggle" key={key}><input type="checkbox" checked={profile[key]} onChange={e => update({ [key]: e.target.checked })} /><span>{t(key === "reverseBacks" ? "reverse" : "rotate")}</span></label>)}
      </>}
      <div className="print-fields">{(["offsetX", "offsetY"] as const).map(key => <NumberField key={key} label={t(key)} min={-5} max={5} step={.1} value={profile[key]} onChange={value => update({ [key]: value })} />)}</div>
      <p className="print-note">{t("offsetHint")}</p>
      <label className="print-toggle"><input type="checkbox" checked={calibrated} onChange={e => onCalibrated(e.target.checked)} /><span>{t("calibrated")}</span></label>
    </details>
    <div className="print-section-title">{t("selection")}</div>
    {booklet && <label className="print-field"><span>{t("scopeSignature")}</span><select aria-label={t("scopeSignature")} value={group} onChange={e => { setGroup(Number(e.target.value)); setSheet(0) }}><option value={0}>{t("all")}</option>{groups.map(g => <option key={g} value={g}>{t("scopeSignature")} {g}</option>)}</select></label>}
    <label className="print-field"><span>{t("scopeSheet")}</span><select aria-label={t("scopeSheet")} value={sheet} onChange={e => setSheet(Number(e.target.value))}><option value={0}>{t("allSheets")}</option>{sheets.map(s => <option key={s} value={s}>{t("scopeSheet")} {s}</option>)}</select></label>
    <p className="print-note">{t("selectionHint")}</p>
    {profile.duplex === "manual" ? <>
      <p className="print-note">{t("manualHint")}</p>
      {!calibrated && <p className="print-note">{t("calibrationRequired")}</p>}
      <button className="print-primary" disabled={disabled || !calibrated} onClick={() => onExport(kind, { ...selection, pass: "front" })}><Download />{t("passFront")}</button>
      <button className="print-secondary" disabled={disabled || !calibrated} onClick={() => onExport(kind, { ...selection, pass: "back" })}><Download />{t("passBack")}</button>
    </> : <button className="print-primary" disabled={disabled} onClick={() => onExport(kind, selection)}><Download />{language.startsWith("es") ? booklet ? "Descargar cuadernillos PDF" : "Descargar interior PDF" : booklet ? "Download booklet PDF" : "Download interior PDF"}</button>}
    {profile.duplex === "manual" ? <>{(["front", "back"] as const).map(pass => <button key={pass} className="print-secondary" disabled={disabled || !calibrated} onClick={() => onExport("proof", { ...(booklet ? { signature: 1 } : { lastSheet: 2 }), pass })}><Download />{t(booklet ? "proof" : "proofHome")} · {t(pass)}</button>)}</>
      : <button className="print-secondary" disabled={disabled} onClick={() => onExport("proof", booklet ? { signature: 1 } : { lastSheet: 2 })}><Download />{t(booklet ? "proof" : "proofHome")}</button>}
  </div>
}
