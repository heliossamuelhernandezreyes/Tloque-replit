import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import AudioCatalogAdmin from "../../client/src/pages/AudioCatalogAdmin"

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><AudioCatalogAdmin /></QueryClientProvider>)
