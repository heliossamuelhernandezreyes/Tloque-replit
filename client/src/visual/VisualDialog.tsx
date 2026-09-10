import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { useSettings } from "@/context/SettingsContext"
import { useVisualEngine } from "./VisualEngine"

/** Focus, Escape, scroll locking and labels stay outside WebGL. */
export default function VisualDialog({ open, onClose, title, description, children }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode
}) {
  const { t } = useSettings()
  const { holdOverlay } = useVisualEngine()
  useEffect(() => { if (open) return holdOverlay(100) }, [open, holdOverlay])
  const returnFocus = useRef<HTMLElement | null>(null)
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="tq-viewer-backdrop" />
      <Dialog.Content className="tq-viewer-content"
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement }}
        onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
        <Dialog.Close className="tq-viewer-close" aria-label={t("closeAction")}><X size={20} /></Dialog.Close>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        <Dialog.Description className="sr-only">{description || title}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
