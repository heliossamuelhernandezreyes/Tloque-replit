import { useQuery } from "@tanstack/react-query"
import { accountFetch } from "@/lib/account-context"
import { RIGHTS_OPTIONS, type RightsOption, type LegalDocument } from "@shared/legal"

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
  return <main className="min-h-screen bg-black p-6 text-white"><section className="mx-auto max-w-3xl"><a href="/" className="underline">Volver a Tloque</a><h1 className="mt-8 font-serif text-3xl">Mis permisos de publicación</h1><p className="mt-4 text-sm text-white/60">Los comprobantes corresponden a versiones confirmadas. Las publicaciones anteriores no se consideran aceptadas automáticamente.</p>
    {query.isLoading && <p className="mt-5">Cargando…</p>}{query.isError && <button className="mt-5 underline" onClick={() => void query.refetch()}>Reintentar carga de permisos</button>}{query.data?.length === 0 && <p className="mt-5">Todavía no hay comprobantes.</p>}
    <div className="mt-6 space-y-3">{query.data?.map(row => <details key={row.id} className="rounded-xl border border-white/15 p-4"><summary>{row.declaration?.workTitle || `Obra ${row.bookId}`} · revisión {row.bookRevision} · {new Date(row.createdAt).toLocaleString()}</summary><p className="mt-4 text-sm">Lectura gratuita en Tloque. Opciones autorizadas:</p><ul className="mt-3 list-inside list-disc space-y-2 text-sm">{(Object.keys(RIGHTS_OPTIONS) as RightsOption[]).filter(key => row.declaration?.choices?.[key] === true).map(key => <li key={key}>{RIGHTS_OPTIONS[key]}</li>)}</ul><button className="my-4 min-h-11 underline" onClick={() => download(row)}>Descargar comprobante íntegro</button>{(row.documents as LegalDocument[]).map(document => <details key={document.id} className="mt-3"><summary>{document.title} · {document.version}</summary><p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/60">{document.text}</p></details>)}</details>)}</div>
  </section></main>
}
