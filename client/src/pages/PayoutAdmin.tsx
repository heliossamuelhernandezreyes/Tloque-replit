import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react"
import { useLocation } from "wouter"
import { Layout } from "@/components/layout"

type PayoutRow = {
  payout: {
    id: number
    amountCents: number
    currency: string
    status: string
    failureCode: string
    requestedAt: string
    completedAt?: string | null
  }
  authorName: string
  authorEmail: string
}

const ACTIVE = new Set(["requested", "processing", "processing_unknown"])

export default function PayoutAdmin() {
  const [, setLocation] = useLocation()
  const [workingId, setWorkingId] = useState<number | null>(null)
  const [message, setMessage] = useState("")
  const { data, isLoading, refetch } = useQuery<{ payouts: PayoutRow[] }>({
    queryKey: ["/api/admin/payouts"],
    queryFn: async () => {
      const response = await fetch("/api/admin/payouts", { credentials: "include" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    },
  })

  async function processPayout(id: number, action: "approve" | "reject") {
    const reason = action === "reject"
      ? window.prompt("Motivo de rechazo (queda en la bitácora):", "revisión administrativa")
      : ""
    if (action === "reject" && reason === null) return
    if (action === "approve" && !window.confirm("¿Confirmas que revisaste la conciliación y deseas transferir este saldo a la cuenta Stripe verificada del autor?")) return
    setWorkingId(id); setMessage("")
    try {
      const response = await fetch(`/api/admin/payouts/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`)
      setMessage(action === "approve" ? "Transferencia confirmada por Stripe." : "Solicitud rechazada; las ganancias volvieron a estar disponibles.")
      await refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo procesar")
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <Layout>
      <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-8 sm:px-6">
        <button onClick={() => setLocation("/admin")} className="mb-5 inline-flex items-center gap-2 text-xs text-white/45 hover:text-white/70">
          <ArrowLeft className="h-3.5 w-3.5" /> Administración
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="tloque-eyebrow">Economía · revisión manual</p>
            <h1 className="mt-1 text-2xl text-white">Liquidaciones de autores</h1>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-white/40">
              Aprobar crea una transferencia idempotente hacia la cuenta Stripe Connect verificada. Stripe realiza después el depósito bancario según la programación del autor.
            </p>
          </div>
          <button aria-label="Actualizar" onClick={() => refetch()} className="rounded-xl border border-white/10 p-2 text-white/40 hover:text-white/70">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {message && <p role="status" className="mt-4 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-white/65">{message}</p>}
        {isLoading ? (
          <div className="mt-10 flex items-center gap-2 text-sm text-white/35"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</div>
        ) : !data?.payouts.length ? (
          <div className="mt-8 rounded-2xl border border-white/[.07] bg-white/[.02] p-6 text-sm text-white/35">No hay solicitudes.</div>
        ) : (
          <div className="mt-6 space-y-3">
            {data.payouts.map(({ payout, authorName, authorEmail }) => (
              <article key={payout.id} className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white/80">{authorName}</p>
                    <p className="text-[11px] text-white/35">{authorEmail} · solicitud #{payout.id}</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      ${(payout.amountCents / 100).toFixed(2)} {payout.currency.toUpperCase()}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-white/55">{payout.status}</span>
                    <p className="mt-2 text-[10px] text-white/25">{new Date(payout.requestedAt).toLocaleString()}</p>
                  </div>
                </div>
                {payout.failureCode && <p className="mt-2 text-[10px] text-amber-200/55">{payout.failureCode}</p>}
                {ACTIVE.has(payout.status) && (
                  <div className="mt-4 flex gap-2">
                    <button disabled={workingId !== null} onClick={() => processPayout(payout.id, "approve")} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-300/85 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">
                      {workingId === payout.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Aprobar
                    </button>
                    <button disabled={workingId !== null} onClick={() => processPayout(payout.id, "reject")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300/20 px-3 py-2 text-xs text-red-200/70 disabled:opacity-40">
                      <XCircle className="h-3.5 w-3.5" /> Rechazar
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    </Layout>
  )
}
