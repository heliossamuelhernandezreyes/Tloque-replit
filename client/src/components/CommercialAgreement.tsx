import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"

export default function CommercialAgreement({ bookId }: { bookId: number }) {
  const [open, setOpen] = useState(false), [acceptedHash, setAcceptedHash] = useState("")
  const client = useQueryClient()
  const query = useQuery<{ hash: string; document: { text: string }; receipt: { accepted_at: string } | null }>({
    queryKey: ["/api/commercial/agreements", bookId], enabled: open, staleTime: 0,
    queryFn: async () => { const r = await accountFetch(`/api/commercial/agreements/${bookId}`, { cache: "no-store" }); const data = await r.json(); if (!r.ok) throw new Error(data.message || "No se pudo cargar el acuerdo"); return data },
  })
  const accept = useMutation({ mutationFn: async () => {
    const r = await accountFetch(`/api/commercial/agreements/${bookId}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: acceptedHash === query.data?.hash, termsHash: acceptedHash }) })
    const data = await r.json(); if (!r.ok) { setAcceptedHash(""); void query.refetch(); throw new Error(data.message || "No se pudo aceptar el acuerdo") } return data
  }, onSuccess: () => { setAcceptedHash(""); void query.refetch(); void client.invalidateQueries({ queryKey: ["/api/commercial/agreements/mine"] }) } })
  return <section className="mt-4 border-t border-white/15 pt-4">
    <button className="min-h-11 underline" onClick={() => setOpen(!open)}>Revisar acuerdo comercial de esta obra</button>
    {open && <div className="space-y-3 text-sm">
      {query.isPending && <p>Cargando acuerdo…</p>}
      {query.isError && <><p role="alert">{query.error.message}</p><button className="underline" onClick={() => void query.refetch()}>Reintentar acuerdo</button></>}
      {query.data && <><p className="whitespace-pre-line leading-7">{query.data.document.text}</p>
        <p className="break-all text-xs text-white/60">Huella del acuerdo: {query.data.hash}</p>
        {query.data.receipt ? <p role="status">Aceptado por tu cuenta el {new Date(query.data.receipt.accepted_at).toLocaleString()}. La habilitación exige además revisión del acuerdo y facultades.</p> : <>
          <label className="flex min-h-11 gap-3"><input type="checkbox" checked={acceptedHash === query.data.hash} onChange={e => setAcceptedHash(e.target.checked ? query.data!.hash : "")} />Leí y acepto este acuerdo comercial para esta edición y sus reglas económicas.</label>
          <button className="min-h-11 rounded-lg bg-amber-100 px-4 text-black disabled:opacity-40" disabled={accept.isPending || acceptedHash !== query.data.hash} onClick={() => accept.mutate()}>Aceptar acuerdo comercial</button>
        </>}
      </>}
      {accept.isError && <p role="alert">{accept.error.message}</p>}
    </div>}
  </section>
}
