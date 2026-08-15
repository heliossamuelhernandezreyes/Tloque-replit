import { useQuery } from "@tanstack/react-query"
import { Heart } from "lucide-react"

interface Props {
  bookId:      number
  accentColor: string
  size?:       "sm" | "md"
}

// El corazón de mérito de una obra: una señal orgánica (apoyos + lectores
// que avanzaron), no una calificación. Si una obra resonó, se nota aquí.
export default function HeartCount({ bookId, accentColor, size = "sm" }: Props) {
  const { data } = useQuery<{ hearts: number }>({
    queryKey: ["/api/books/hearts", bookId],
    queryFn: async () => {
      const res = await fetch(`/api/books/${bookId}/hearts`)
      if (!res.ok) return { hearts: 0 }
      return res.json()
    },
    staleTime: 60_000,
  })
  const hearts = data?.hearts ?? 0
  if (hearts <= 0) return null

  const iconSize = size === "md" ? "w-4 h-4" : "w-3 h-3"
  const textSize = size === "md" ? "text-xs" : "text-[10px]"

  return (
    <span className="inline-flex items-center gap-1" title="Apoyos y lectores que llegaron lejos">
      <Heart className={iconSize} style={{ color: accentColor, fill: accentColor }} />
      <span className={`${textSize} font-sans font-semibold`} style={{ color: accentColor }}>
        {hearts}
      </span>
    </span>
  )
}
