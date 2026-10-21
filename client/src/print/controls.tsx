import { useEffect, useState } from "react"

export function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <label className="print-field"><span>{label}</span><input aria-label={label} type="number" inputMode="decimal" min={min} max={max} step={step} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }} onBlur={() => {
    const parsed = draft.trim() ? Number(draft) : NaN
    const n = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value
    setDraft(String(n)); if (n !== value) onChange(n)
  }} /></label>
}
