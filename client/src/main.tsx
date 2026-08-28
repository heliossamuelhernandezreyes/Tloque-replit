import { Component, type ErrorInfo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { installTloqueScoreFileBridge } from "./lib/tloqueScoreFileBridge"

interface BoundaryState { failed: boolean }

class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tloque no pudo renderizar la interfaz", error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <BootFailure />
  }
}

function BootFailure() {
  return (
    <main className="fixed inset-0 bg-black flex items-center justify-center px-6 text-white">
      <section className="max-w-sm text-center" role="alert">
        <div className="mx-auto mb-5 h-2 w-2 rounded-full bg-red-300/70" />
        <h1 className="font-serif text-xl">Tloque encontró un problema</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          No se perdió tu biblioteca. Recarga la aplicación para volver a intentarlo.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-full border border-white/20 px-5 py-2 text-sm text-white/80"
        >
          Recargar
        </button>
      </section>
    </main>
  )
}

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("No se encontró el contenedor principal")
const root = createRoot(rootElement)

installTloqueScoreFileBridge()

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .catch(error => console.warn("No se pudo activar el modo offline", error))
  })
}

// La importación diferida permite mostrar una recuperación legible si un
// módulo de la aplicación falla durante su evaluación inicial.
void import("./App")
  .then(({ default: App }) => {
    root.render(<RootErrorBoundary><App /></RootErrorBoundary>)
  })
  .catch(error => {
    console.error("Tloque no pudo cargar el módulo principal", error)
    root.render(<BootFailure />)
  })
