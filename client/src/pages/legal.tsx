import { useQuery } from "@tanstack/react-query"
import type { LegalDocument } from "@shared/legal"

export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const query = useQuery<{ documents: LegalDocument[] }>({
    queryKey: ["/api/legal/documents", "public"],
    queryFn: async () => {
      const response = await fetch("/api/legal/documents", { cache: "no-store", credentials: "omit" })
      if (!response.ok) throw new Error("No se pudieron cargar las condiciones")
      return response.json()
    }, retry: false,
  })
  const document = query.data?.documents.find(item => item.id === kind)
  return <main className="min-h-screen bg-black px-5 py-8 text-zinc-300"><article className="mx-auto max-w-3xl">
    <a href="/" className="text-sm underline">Volver a Tloque</a><h1 className="mt-8 font-serif text-3xl text-white">{kind === "privacy" ? "Privacidad" : "Términos de uso"}</h1>
    {query.isLoading && <p role="status" className="mt-6">Cargando…</p>}
    {query.isError && <div className="mt-6" role="alert">No pudimos cargar el documento. <button onClick={() => void query.refetch()} className="underline">Reintentar</button></div>}
    {document && <><p className="mt-4 text-xs text-white/50">Versión {document.version}</p><div className="mt-6 space-y-5 text-sm leading-7">{document.text.split("\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></>}
    <nav className="mt-8 flex flex-wrap gap-5 border-t border-white/15 pt-6 text-sm"><a href="/rights" className="underline">Derechos de autor y contraavisos</a><a href="/privacy/requests" className="underline">Presentar solicitud de privacidad</a><a href="/legal/receipts" className="underline">Mis permisos de publicación</a><a href={kind === "privacy" ? "/terms" : "/privacy"} className="underline">{kind === "privacy" ? "Términos" : "Privacidad"}</a></nav>
  </article></main>
}
