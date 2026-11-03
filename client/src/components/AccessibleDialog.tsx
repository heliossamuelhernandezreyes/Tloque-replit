import * as Dialog from "@radix-ui/react-dialog"
import { useRef, type CSSProperties, type ReactNode } from "react"

/** Shared keyboard, scroll and focus behavior; each surface keeps its own contents. */
export default function AccessibleDialog({ open, onClose, title, children, className = "", style, sheet = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
  className?: string; style?: CSSProperties; sheet?: boolean
}) {
  const origin = useRef<HTMLElement | null>(null)
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose() }}><Dialog.Portal>
    <Dialog.Overlay className="tloque-dialog-backdrop" />
    <Dialog.Content className={`tloque-dialog-panel ${sheet ? "is-sheet" : ""} ${className}`} style={style}
      aria-describedby={undefined}
      onOpenAutoFocus={() => { origin.current = document.activeElement as HTMLElement }}
      onCloseAutoFocus={event => { if (origin.current?.isConnected) { event.preventDefault(); origin.current.focus() } }}>
      <Dialog.Title className="sr-only">{title}</Dialog.Title>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}

