import { useEffect } from "react"
import { useLocation, useSearch } from "wouter"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { accountFetch as fetch, accountStorage } from "@/lib/account-context"
import { reconcileWalletIntent, type WalletOrderStatus } from "@/lib/wallet-purchase"
import { displayTinta } from "@shared/tinta"

export default function WalletReturnNotice() {
  const search = useSearch()
  const [path, setLocation] = useLocation()
  const orderId = new URLSearchParams(search).get("tinta")
  const validId = !!orderId && /^[1-9][0-9]*$/.test(orderId)
  const client = useQueryClient()
  const order = useQuery<WalletOrderStatus>({
    queryKey: ["/api/wallet/orders", orderId], enabled: validId, retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/wallet/orders/${orderId}`, { cache: "no-store" })
      if (!response.ok) throw new Error("No se pudo verificar esta recarga para tu cuenta.")
      return response.json()
    },
    refetchInterval: query => query.state.data?.status === "pending" && query.state.dataUpdateCount < 30 ? 2000 : false,
  })
  useEffect(() => {
    if (!order.data || order.data.status === "pending") return
    reconcileWalletIntent(accountStorage, order.data)
    void client.invalidateQueries({ queryKey: ["/api/wallet"] })
  }, [order.data, client])
  if (!orderId) return null
  const dismiss = () => {
    const params = new URLSearchParams(search); params.delete("tinta")
    setLocation(path + (params.size ? `?${params}` : ""), { replace: true })
  }
  return <div role="status" className="fixed left-4 right-4 top-4 z-[100] mx-auto max-w-lg rounded-2xl border border-white/20 bg-zinc-950 p-4 text-sm text-white shadow-xl">
    <p>{!validId || order.isError ? "No se pudo verificar esta recarga para tu cuenta."
      : order.data?.status === "paid" ? `Recarga confirmada: ${displayTinta(order.data.units)} Tintas. Tu saldo está actualizado.`
      : order.data?.status === "pending" ? "Tu pago sigue pendiente de confirmación. El saldo se actualizará cuando se confirme."
      : order.data ? "Esta recarga terminó sin confirmarse. Puedes iniciar otra desde tu monedero."
      : "Verificando tu recarga…"}</p>
    {(order.isError || order.data?.status === "pending") && <button className="mr-4 mt-2 min-h-11 underline" onClick={() => { void order.refetch() }}>Verificar de nuevo</button>}
    <button className="mt-2 min-h-11 underline" onClick={dismiss}>Cerrar</button>
  </div>
}
