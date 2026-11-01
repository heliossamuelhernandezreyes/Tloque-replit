import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { money, type EconomicQuote } from "@shared/commerce"

type Entry = { id: number; orderId: number; bookId: number; status: string; grossCents: number; authorCents: number; platformCents: number; provider: string; payoutEligible: boolean; economics: EconomicQuote | null; settlement: { availableAt: string; minimumCents: number; frozen: boolean } }
export default function CommercialStatement() {
  const [open, setOpen] = useState(false), [before, setBefore] = useState<number | null>(null)
  const query = useQuery<{ entries: Entry[]; nextCursor: number | null }>({ queryKey: ["/api/commercial/statement", before], enabled: open,
    queryFn: async () => { const r = await accountFetch(`/api/commercial/statement${before ? `?before=${before}` : ""}`, { cache: "no-store" }); if (!r.ok) throw new Error("No se pudo cargar el estado de cuenta"); return r.json() } })
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(query.data, null, 2)], { type: "application/json" }))
    const a = document.createElement("a"); a.href = url; a.download = `tloque-movimientos-${before || "inicio"}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="mt-8 space-y-3"><h2 className="text-xl">Estado de cuenta del titular</h2>
    <button className="min-h-11 underline" onClick={() => setOpen(!open)}>Consultar mis movimientos económicos</button>
    {open && <><p className="text-sm text-white/60">Importes en pesos. El devengo, la disponibilidad y la transferencia son estados distintos; los bonos sin respaldo no son ganancias retirables.</p>
      {query.isPending && <p>Cargando…</p>}{query.isError && <button className="underline" onClick={() => void query.refetch()}>Reintentar movimientos</button>}
      {query.data?.entries.length === 0 && <p>No hay movimientos en esta página.</p>}
      {query.data?.entries.map(row => <details key={row.id} className="rounded-xl border border-white/15 p-4"><summary>Orden {row.orderId} · obra {row.bookId} · {row.status} · titular {money(row.authorCents)}</summary>
        <p className="mt-3 text-sm">Base efectiva {money(row.grossCents)} · Tloque {money(row.platformCents)} · medio {row.provider}.</p>
        <p className="mt-2 text-sm">Espera hasta {new Date(row.settlement.availableAt).toLocaleString()} · mínimo {money(row.settlement.minimumCents)}. {row.payoutEligible ? "Sujeto al estado de la operación y a su conciliación." : "No disponible para una nueva liquidación."}</p>
        <p className="mt-2 break-all text-xs text-white/60">{row.economics ? `Acuerdo ${row.economics.agreementId} · ${row.economics.agreementHash}` : "Registro histórico: sin aceptación económica reconstruida retroactivamente."}</p>
      </details>)}
      {query.data && <button className="min-h-11 underline" onClick={download}>Descargar esta página de movimientos</button>}
      <div className="flex gap-4">{before && <button className="min-h-11 underline" onClick={() => setBefore(null)}>Volver al inicio</button>}{query.data?.nextCursor && <button className="min-h-11 underline" onClick={() => setBefore(query.data!.nextCursor)}>Siguientes movimientos</button>}</div>
    </>}
  </section>
}
