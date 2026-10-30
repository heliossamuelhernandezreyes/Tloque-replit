// Browser QA entry, never imported by the product bundle.
import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { accountContext } from "../../client/src/lib/account-context"
import PublicationConsent from "../../client/src/components/PublicationConsent"
import PrivacyRequest from "../../client/src/pages/PrivacyRequest"
import PrivacyAdmin from "../../client/src/pages/PrivacyAdmin"
import "../../client/src/index.css"

let root: Root | undefined
let generation = 0
export function renderLegalFixture(view: "publication" | "request" | "admin") {
  accountContext.activate(599)
  root ||= createRoot(document.getElementById("root")!)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  root.render(<QueryClientProvider key={++generation} client={client}>{view === "publication"
    ? <PublicationConsent category="book" onCancel={() => { (window as any).cancelled = true }} onConfirm={value => { (window as any).confirmed = value }} />
    : view === "request" ? <PrivacyRequest /> : <PrivacyAdmin />}</QueryClientProvider>)
}
