interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-black text-zinc-300 font-serif overflow-x-hidden">
      <main className="relative z-10 w-full pt-[4.5rem] pb-40">
        {children}
      </main>
    </div>
  )
}
