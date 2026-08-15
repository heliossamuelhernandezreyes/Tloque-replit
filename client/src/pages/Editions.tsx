import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookCopy, CheckCircle2, CircleDollarSign, RotateCcw, Tag } from "lucide-react"
import { Layout } from "@/components/layout"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { experienceText } from "@shared/experience-i18n"

type Edition = {
  id: number; folio: string; tokenId: number; saleStatus: "available" | "sold" | "returned"
  soldAt: string | null; salePriceCents: number | null; saleChannel: string; saleNote: string
  digitalClaimed: boolean; book: { id: number; title: string; author: string; coverUrl: string } | null
}
type Payload = { editions: Edition[]; summary: { total: number; available: number; sold: number; returned: number; digitalClaimed: number } }

export default function Editions() {
  const { cfg } = useGenre()
  const { settings } = useSettings()
  const client = useQueryClient()
  const [editing, setEditing] = useState<Edition | null>(null)
  const [price, setPrice] = useState("")
  const [channel, setChannel] = useState("")
  const [note, setNote] = useState("")
  const copy = (key: Parameters<typeof experienceText>[1]) => experienceText(settings.language, key)
  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["/api/author/editions"],
    queryFn: async () => {
      const response = await fetch("/api/author/editions", { credentials: "include" })
      if (!response.ok) throw new Error("editions")
      return response.json()
    },
  })
  const update = useMutation({
    mutationFn: async ({ edition, status }: { edition: Edition; status: Edition["saleStatus"] }) => {
      const response = await fetch(`/api/author/editions/${edition.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, priceCents: price ? Math.round(Number(price) * 100) : null, channel, note }),
      })
      if (!response.ok) throw new Error("update")
      return response.json()
    },
    onSuccess: () => { setEditing(null); client.invalidateQueries({ queryKey: ["/api/author/editions"] }) },
  })
  function open(edition: Edition) {
    setEditing(edition); setPrice(edition.salePriceCents == null ? "" : (edition.salePriceCents / 100).toFixed(2)); setChannel(edition.saleChannel || ""); setNote(edition.saleNote || "")
  }
  const summary = data?.summary || { total: 0, available: 0, sold: 0, returned: 0, digitalClaimed: 0 }

  return (
    <Layout>
      <section className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        <p className="tloque-eyebrow">Tloque</p><h1 className="mt-1 text-2xl text-white">{copy("commercialCopies")}</h1><p className="mt-2 text-sm text-zinc-500">{copy("commercialHint")}</p>
        <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["total", "available", "sold", "returned", "digitalClaimed"] as const).map(key => <div key={key} className="tloque-stat"><span>{copy(key)}</span><strong style={{ color: key === "sold" ? cfg.color : undefined }}>{summary[key]}</strong></div>)}
        </div>
        {!isLoading && !data?.editions.length && <div className="tloque-surface py-16 text-center"><BookCopy className="mx-auto h-8 w-8 text-white/15" /><p className="mt-3 text-sm text-zinc-500">{copy("noEditions")}</p></div>}
        {!!data?.editions.length && <div className="tloque-surface overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-white/[.06] text-[10px] uppercase tracking-wider text-white/30"><tr><th className="px-5 py-3">{copy("editions")}</th><th className="px-4 py-3">Folio</th><th className="px-4 py-3">{copy("sold")}</th><th className="px-4 py-3">Digital</th><th className="px-4 py-3">{copy("price")}</th><th className="px-4 py-3" /></tr></thead><tbody>{data.editions.map(edition => <tr key={edition.id} className="border-b border-white/[.05] last:border-0"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="h-12 w-8 overflow-hidden rounded bg-white/5">{edition.book?.coverUrl && <img src={edition.book.coverUrl} alt="" className="h-full w-full object-cover" />}</div><div><p className="max-w-56 truncate text-white">{edition.book?.title || "—"}</p><p className="mt-0.5 text-[11px] text-zinc-600">{edition.book?.author}</p></div></div></td><td className="px-4 py-4 font-mono text-xs text-white/55">{edition.folio}</td><td className="px-4 py-4"><Status status={edition.saleStatus} copy={copy} /></td><td className="px-4 py-4"><span className={edition.digitalClaimed ? "text-emerald-300/70" : "text-white/30"}>{edition.digitalClaimed ? copy("digitalClaimed") : copy("digitalPending")}</span></td><td className="px-4 py-4 text-white/50">{edition.salePriceCents == null ? "—" : `$${(edition.salePriceCents / 100).toFixed(2)} MXN`}</td><td className="px-4 py-4 text-right"><button className="tloque-secondary-button" onClick={() => open(edition)}><Tag className="h-3.5 w-3.5" />{edition.saleStatus === "sold" ? copy("markAvailable") : copy("markSold")}</button></td></tr>)}</tbody></table></div></div>}
      </section>
      {editing && <div className="fixed inset-0 z-[500] flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center" onClick={() => setEditing(null)}><div className="tloque-surface w-full max-w-md p-5" onClick={event => event.stopPropagation()}><h2 className="text-lg text-white">{editing.book?.title}</h2><p className="mt-1 font-mono text-xs text-zinc-600">{editing.folio}</p><div className="mt-5 grid grid-cols-2 gap-3"><label className="tloque-field"><span>{copy("price")} · MXN</span><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label><label className="tloque-field"><span>{copy("channel")}</span><input value={channel} onChange={e => setChannel(e.target.value)} placeholder="Feria, tienda…" /></label></div><label className="tloque-field mt-3"><span>{copy("note")}</span><input value={note} onChange={e => setNote(e.target.value)} maxLength={300} /></label><div className="mt-5 flex flex-wrap justify-end gap-2"><button className="tloque-secondary-button" onClick={() => setEditing(null)}>{copy("cancel")}</button>{editing.saleStatus === "sold" && <button className="tloque-secondary-button" onClick={() => update.mutate({ edition: editing, status: "returned" })}><RotateCcw className="h-4 w-4" />{copy("markReturned")}</button>}<button className="tloque-primary-button" style={{ background: cfg.color }} onClick={() => update.mutate({ edition: editing, status: editing.saleStatus === "sold" ? "available" : "sold" })} disabled={update.isPending}>{editing.saleStatus === "sold" ? copy("markAvailable") : copy("markSold")}</button></div></div></div>}
    </Layout>
  )
}

function Status({ status, copy }: { status: Edition["saleStatus"]; copy: (key: Parameters<typeof experienceText>[1]) => string }) {
  const Icon = status === "sold" ? CircleDollarSign : status === "returned" ? RotateCcw : CheckCircle2
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] ${status === "sold" ? "bg-amber-300/10 text-amber-200/70" : status === "returned" ? "bg-violet-300/10 text-violet-200/65" : "bg-emerald-300/10 text-emerald-200/65"}`}><Icon className="h-3 w-3" />{copy(status)}</span>
}
