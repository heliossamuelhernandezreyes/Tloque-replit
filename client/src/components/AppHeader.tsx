import { useQuery } from "@tanstack/react-query"
import { Bell, BookOpen, Library, PenLine, Shield, UserRound } from "lucide-react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/useAuth"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { experienceText } from "@shared/experience-i18n"

type NotificationPayload = { notifications: unknown[]; unread: number }

export default function AppHeader() {
  const [location, setLocation] = useLocation()
  const { user, isAdmin } = useAuth()
  const { cfg } = useGenre()
  const { settings } = useSettings()
  const copy = (key: Parameters<typeof experienceText>[1]) => experienceText(settings.language, key)
  const { data } = useQuery<NotificationPayload>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const response = await fetch("/api/notifications", { credentials: "include" })
      return response.ok ? response.json() : { notifications: [], unread: 0 }
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const items = [
    { href: "/library", label: copy("library"), Icon: Library },
    { href: "/editor", label: copy("studio"), Icon: PenLine },
    { href: "/inbox", label: copy("inbox"), Icon: Bell, badge: data?.unread || 0 },
    { href: "/profile", label: copy("profile"), Icon: UserRound },
  ]
  if (isAdmin) items.push({ href: "/admin", label: copy("admin"), Icon: Shield, badge: 0 })

  return (
    <header className="tloque-app-header" aria-label="Tloque">
      <button className="tloque-brand" onClick={() => setLocation("/")} aria-label={copy("home")}>
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Tloque</span>
      </button>
      <nav className="tloque-header-nav" aria-label="Navegación principal">
        {items.map(({ href, label, Icon, badge }) => {
          const active = location === href || (href !== "/" && location.startsWith(`${href}/`))
          return (
            <button
              key={href}
              onClick={() => setLocation(href)}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="tloque-header-action"
              style={active ? { color: cfg.color, borderColor: `${cfg.color}55`, background: `${cfg.glow}18` } : undefined}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="hidden md:inline">{label}</span>
              {!!badge && <span className="tloque-header-badge" aria-label={`${badge} ${copy("unread")}`}>{badge > 9 ? "9+" : badge}</span>}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
