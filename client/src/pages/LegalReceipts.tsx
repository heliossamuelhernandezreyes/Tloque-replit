import { useQuery } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { RIGHTS_OPTIONS, type RightsOption, type LegalDocument } from "@shared/legal"
import CommercialAgreement from "@/components/CommercialAgreement"
import CommercialStatement from "@/components/CommercialStatement"
import { money } from "@shared/commerce"

export default function LegalReceipts() {
  function download(row: any) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(row, null, 2)], { type: "application/json" }))
    const link = document.createElement("a"); link.href = url; link.download = `tloque-permiso-${row.id}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const query = useQuery<any[]>({ queryKey: ["/api/legal/receipts"], queryFn: async () => {
    const response = await accountFetch("/api/legal/receipts", { credentials: "include", cache: "no-store" })
    if (!response.ok) throw new Error("No se pudieron cargar tus permisos")
    return response.json()
  } })
  const purchases = useQuery<any[]>({ queryKey: ["/api/tokens/receipts"], queryFn: async () => {
    const response = await accountFetch("/api/tokens/receipts", { cache: "no-store" }); if (!response.ok) throw new Error("No se pudieron cargar tus compras"); return response.json()
  } })
  const agreements = useQuery<any[]>({ queryKey: ["/api/commercial/agreements/mine"], queryFn: async () => {
    const r = await accountFetch("/api/commercial/agreements/mine", { cache: "no-store" }); if (!r.ok) throw new Error("No se pudieron cargar tus acuerdos"); return r.json()
  } })
  return <main className="min-h-screen bg-black p-6 text-white"><section className="mx-auto max-w-3xl"><a href="/" className="underline">Volver a Tloque</a><h1 className="mt-8 font-serif text-3xl">Mis comprobantes</h1>
    <CommercialStatement />
    <h2 className="mt-8 text-xl">Acuerdos comerciales aceptados</h2>
    {agreements.isError && <button className="min-h-11 underline" onClick={() => void agreements.refetch()}>Reintentar acuerdos</button>}
    {agreements.data?.map(row => <details className="mt-4 rounded-xl border border-white/15 p-4" key={row.id}><summary>Obra {row.book_id} · acuerdo {row.id} · {new Date(row.accepted_at).toLocaleString()}</summary><p className="mt-3 break-words whitespace-pre-line text-sm leading-7">{row.terms.text}</p><button className="min-h-11 underline" onClick={() => download(row)}>Descargar acuerdo aceptado</button></details>)}
    <h2 className="mt-8 text-xl">Compras y licencias de lectura</h2>
    {purchases.isError && <button onClick={() => void purchases.refetch()} className="mt-4 underline">Reintentar carga de compras</button>}
    {purchases.data?.length === 0 && <p className="mt-4 text-sm">Todavía no hay compras registradas.</p>}
    {purchases.data?.map(row => <details className="mt-4 rounded-xl border border-white/15 p-4" key={row.id}><summary>Obra {row.bookId} · {row.kind === "support" ? "Token 1" : "Token comercial"} · {row.status}</summary><p className="mt-3 text-sm">{row.purchaseTerms ? `Edición adquirida ${row.editionId} · revisión de condiciones ${row.purchaseTerms.version}` : "Compra histórica: conserva sus registros originales; no se ha fabricado una aceptación retroactiva."}</p><>{row.purchaseTerms?.economics && <p className="mt-3 text-sm">Base efectiva {money(row.purchaseTerms.economics.cashBasisCents)} · titular {money(row.purchaseTerms.economics.authorCents)} · Tloque {money(row.purchaseTerms.economics.platformCents)}.</p>}</><button className="mt-4 min-h-11 underline" onClick={() => download(row)}>Descargar comprobante de compra</button></details>)}
    <h2 className="mt-8 text-xl">Permisos de publicación</h2><p className="mt-4 text-sm text-white/60">Los comprobantes corresponden a versiones confirmadas. Las publicaciones anteriores no se consideran aceptadas automáticamente.</p>
    {query.isLoading && <p className="mt-5">Cargando…</p>}{query.isError && <button className="mt-5 underline" onClick={() => void query.refetch()}>Reintentar carga de permisos</button>}{query.data?.length === 0 && <p className="mt-5">Todavía no hay comprobantes.</p>}
    <div className="mt-6 space-y-3">{query.data?.map(row => <details key={row.id} className="rounded-xl border border-white/15 p-4"><summary>{row.declaration?.workTitle || `Obra ${row.bookId}`} · revisión {row.bookRevision} · {new Date(row.createdAt).toLocaleString()}</summary><p className="mt-4 text-sm">Lectura gratuita en Tloque. Opciones autorizadas:</p><ul className="mt-3 list-inside list-disc space-y-2 text-sm">{(Object.keys(RIGHTS_OPTIONS) as RightsOption[]).filter(key => row.declaration?.choices?.[key] === true).map(key => <li key={key}>{RIGHTS_OPTIONS[key]}</li>)}</ul><button className="my-4 min-h-11 underline" onClick={() => download(row)}>Descargar comprobante íntegro</button>{(row.documents as LegalDocument[]).map(document => <details key={document.id} className="mt-3"><summary>{document.title} · {document.version}</summary><p className="mt-3 break-words whitespace-pre-line text-sm leading-6 text-white/60">{document.text}</p></details>)}<CommercialAgreement bookId={row.bookId} /></details>)}</div>
  </section></main>
}
