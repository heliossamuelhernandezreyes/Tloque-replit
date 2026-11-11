export default function QueryNotice({ loading, error, cached, onRetry }: { loading?: boolean; error?: boolean; cached?: boolean; onRetry: () => void }) {
  if (loading) return <p role="status" className="my-4 text-sm text-zinc-300">Cargando…</p>
  if (!error && !cached) return null
  return <div role={error ? "alert" : "status"} className="my-4 rounded-xl border border-amber-200/30 p-4 text-sm text-amber-100">
    <p>{cached ? "Mostramos el catálogo guardado. Los resultados pueden estar incompletos." : "No se pudo cargar la información. Comprueba tu conexión o vuelve a iniciar sesión."}</p>
    <button className="mt-2 min-h-11 rounded-lg border border-white/25 px-4 text-white" onClick={onRetry}>Reintentar</button>
  </div>
}
