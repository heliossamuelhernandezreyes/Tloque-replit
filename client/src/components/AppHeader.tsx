import { useQuery } from "@tanstack/react-query"
import * as Dialog from "@radix-ui/react-dialog"
import {
  Bell,
  Home,
  Library,
  Menu,
  PenLine,
  Shield,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react"
import { useLocation } from "wouter"
import { useAuth } from "@/hooks/useAuth"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"
import { experienceText, type ExperienceKey } from "@shared/experience-i18n"

type NotificationPayload = { notifications: unknown[]; unread: number }
type NavigationItem = { href: string; label: string; Icon: LucideIcon; badge?: number }

function isCurrentRoute(location: string, href: string): boolean {
  return location === href || (href !== "/" && location.startsWith(`${href}/`))
}

export default function AppHeader() {
  const [location, setLocation] = useLocation()
  const { user, isAdmin } = useAuth()
  const { cfg } = useGenre()
  const { settings } = useSettings()
  const copy = (key: ExperienceKey) => experienceText(settings.language, key)
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

  const items: NavigationItem[] = [
    { href: "/library", label: copy("library"), Icon: Library },
    { href: "/editor", label: copy("studio"), Icon: PenLine },
    { href: "/inbox", label: copy("inbox"), Icon: Bell, badge: data?.unread || 0 },
    { href: "/profile", label: copy("profile"), Icon: UserRound },
  ]
  if (isAdmin) items.push({ href: "/admin", label: copy("admin"), Icon: Shield })

  const mobileItems: NavigationItem[] = [
    { href: "/", label: copy("home"), Icon: Home },
    ...items,
  ]
  const personaKey: ExperienceKey = user?.persona === "admin"
    ? "administrator"
    : user?.persona === "author"
      ? "author"
      : "reader"

  return (
    <header className="tloque-app-header" aria-label="Tloque">
      <button className="tloque-brand" onClick={() => setLocation("/")} aria-label={copy("home")}>
        <span className="tloque-brand-sigil" aria-hidden="true"><i /></span>
        <span>Tloque</span>
      </button>

      <nav className="tloque-header-nav hidden md:flex" aria-label="Navegación principal">
        {items.map(({ href, label, Icon, badge }) => {
          const active = isCurrentRoute(location, href)
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
              <span>{label}</span>
              {!!badge && <NotificationBadge count={badge} label={copy("unread")} />}
            </button>
          )
        })}
      </nav>

      <div className="flex items-center gap-1 md:hidden">
        <button
          type="button"
          className="tloque-header-action"
          onClick={() => setLocation("/inbox")}
          aria-label={copy("inbox")}
          aria-current={isCurrentRoute(location, "/inbox") ? "page" : undefined}
          style={isCurrentRoute(location, "/inbox") ? { color: cfg.color, borderColor: `${cfg.color}55`, background: `${cfg.glow}18` } : undefined}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {!!data?.unread && <NotificationBadge count={data.unread} label={copy("unread")} />}
        </button>

        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button type="button" className="tloque-menu-trigger" aria-label={copy("accountMode")}>
              {user?.avatar ? (
                <img src={user.avatar} alt="" />
              ) : (
                <Menu className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="tloque-menu-orbit" aria-hidden="true" style={{ borderColor: `${cfg.color}70` }} />
            </button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="tloque-menu-overlay" />
            <Dialog.Content className="tloque-menu-sheet">
              <div className="tloque-menu-aurora" aria-hidden="true" style={{ background: cfg.glow }} />
              <div className="tloque-menu-heading">
                <div>
                  <p className="tloque-eyebrow">{copy("accountMode")}</p>
                  <Dialog.Title>{user?.name || "Tloque"}</Dialog.Title>
                  <Dialog.Description className="tloque-menu-description">{copy(personaKey)}</Dialog.Description>
                </div>
                <Dialog.Close className="tloque-menu-close" aria-label="Cerrar">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Dialog.Close>
              </div>

              <nav className="tloque-menu-navigation" aria-label="Navegación principal">
                {mobileItems.map(({ href, label, Icon, badge }, index) => {
                  const active = isCurrentRoute(location, href)
                  return (
                    <Dialog.Close asChild key={href}>
                      <button
                        type="button"
                        onClick={() => setLocation(href)}
                        aria-current={active ? "page" : undefined}
                        className="tloque-menu-item"
                        style={active ? { borderColor: `${cfg.color}42`, background: `${cfg.glow}16` } : undefined}
                      >
                        <span className="tloque-menu-index">{String(index + 1).padStart(2, "0")}</span>
                        <Icon className="h-4 w-4" style={active ? { color: cfg.color } : undefined} aria-hidden="true" />
                        <span>{label}</span>
                        {!!badge && <NotificationBadge count={badge} label={copy("unread")} />}
                        <i aria-hidden="true" style={active ? { background: cfg.color, boxShadow: `0 0 15px ${cfg.glow}` } : undefined} />
                      </button>
                    </Dialog.Close>
                  )
                })}
              </nav>

              <p className="tloque-menu-footer">TLOQUE · ARCHIVO VIVO</p>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  )
}

function NotificationBadge({ count, label }: { count: number; label: string }) {
  return (
    <span className="tloque-header-badge" aria-label={`${count} ${label}`}>
      {count > 9 ? "9+" : count}
    </span>
  )
}
