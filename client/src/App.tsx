import { lazy, Suspense, useState, useEffect, type ReactNode, type ComponentType } from "react"
import { Switch, Route } from "wouter"
import { queryClient } from "./lib/queryClient"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { GenreProvider } from "@/context/GenreContext"
import { SettingsProvider } from "@/context/SettingsContext"
import { useSettings } from "@/context/SettingsContext"
import { MotionConfig } from "framer-motion"
import BootExperience, { type BootPhase } from "@/components/BootExperience"
import ExperienceShell from "@/components/ExperienceShell"
import Onboarding  from "@/components/Onboarding"
import LoginScreen from "@/components/LoginScreen"
import { useAuth } from "@/hooks/useAuth"
import { pullAndMerge } from "@/lib/sync"

const NotFound = lazy(() => import("@/pages/not-found"))
const Home = lazy(() => import("@/pages/home"))
const Library = lazy(() => import("@/pages/library"))
const Reader = lazy(() => import("@/pages/reader"))
const BookPage = lazy(() => import("@/pages/book"))
const Editor = lazy(() => import("@/pages/editor"))
const EditorDirection = lazy(() => import("@/pages/editor-direction"))
const AuthorPage = lazy(() => import("@/pages/author"))
const ClaimPage = lazy(() => import("@/pages/claim"))
const FrameWorkshop = lazy(() => import("@/pages/FrameWorkshop"))
const FrameGallery = lazy(() => import("@/pages/FrameGallery"))
const CardStudio = lazy(() => import("@/pages/CardStudio"))
const GachaScreen = lazy(() => import("@/pages/GachaScreen"))
const FlickerLab = lazy(() => import("@/pages/FlickerLab"))
const AudioCatalogAdmin = lazy(() => import("@/pages/AudioCatalogAdmin"))
const VscoInstallerAdmin = lazy(() => import("@/pages/VscoInstallerAdmin"))
const KeyboardInstallerAdmin = lazy(() => import("@/pages/KeyboardInstallerAdmin"))
const PhysicalModelLab = lazy(() => import("@/pages/PhysicalModelLab"))
const ProfileHub = lazy(() => import("@/pages/ProfileHub"))
const Inbox = lazy(() => import("@/pages/Inbox"))
const Editions = lazy(() => import("@/pages/Editions"))
const AdminHub = lazy(() => import("@/pages/AdminHub"))
const LegalPage = lazy(() => import("@/pages/legal"))
import { CardViewerProvider } from "@/components/CardViewer"
import { MusicProvider } from "@/audio/MusicProvider"
import {
  BOOT_EXIT_MS,
  SLOW_BOOT_MS,
  minimumBootDuration,
} from "@shared/experience-shell"

const BOOT_SESSION_KEY = "tloque_boot_seen_v1"
const LEGACY_SPLASH_KEY = "novareads_splash_shown"

function hasSessionValue(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

function rememberBoot(): void {
  try {
    sessionStorage.setItem(BOOT_SESSION_KEY, "1")
    sessionStorage.setItem(LEGACY_SPLASH_KEY, "1")
  } catch {
    // La app también debe abrir si el navegador bloquea el almacenamiento.
  }
}

function needsOnboarding(): boolean {
  try {
    return !localStorage.getItem("novareads_onboarding_done")
  } catch {
    return true
  }
}

function Router() {
  const adminPage = (Page: ComponentType<any>) => () => <AdminOnly><Page /></AdminOnly>
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/"                        component={Home}     />
        <Route path="/library"                 component={Library}  />
        <Route path="/book/:id"                component={BookPage} />
        <Route path="/read/:bookId/:chapterId" component={Reader}   />
        <Route path="/editor/direction"        component={EditorDirection} />
        <Route path="/editor"                  component={Editor}     />
        <Route path="/profile"                 component={ProfileHub} />
        <Route path="/inbox"                   component={Inbox} />
        <Route path="/editions"                component={Editions} />
        <Route path="/author/:name"            component={AuthorPage} />
        <Route path="/claim/:folio"            component={ClaimPage} />
        <Route path="/sorteo"                  component={GachaScreen} />
        <Route path="/tarjetas"                component={CardStudio} />
        <Route path="/tarjetas/:bookId"        component={CardStudio} />
        <Route path="/marcos"                  component={FrameGallery} />
        <Route path="/admin"                   component={adminPage(AdminHub)} />
        <Route path="/admin/diag"              component={adminPage(FlickerLab)} />
        <Route path="/admin/marcos"            component={adminPage(FrameWorkshop)} />
        <Route path="/admin/fonoteca"          component={adminPage(AudioCatalogAdmin)} />
        <Route path="/admin/audio/vsco-strings" component={adminPage(VscoInstallerAdmin)} />
        <Route path="/admin/audio/vsco-woodwinds" component={adminPage(VscoInstallerAdmin)} />
        <Route path="/admin/audio/vsco-brass" component={adminPage(VscoInstallerAdmin)} />
        <Route path="/admin/audio/vsco-percussion" component={adminPage(VscoInstallerAdmin)} />
        <Route path="/admin/audio/vsco-violin" component={adminPage(VscoInstallerAdmin)} />
        <Route path="/admin/audio/keyboards" component={adminPage(KeyboardInstallerAdmin)} />
        <Route path="/admin/audio/physical-models" component={adminPage(PhysicalModelLab)} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  )
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading, authError, retryAuth } = useAuth()
  if (isLoading) return <RouteFallback />
  if (authError) return <AuthUnavailable onRetry={() => { void retryAuth() }} />
  if (!isAdmin) return <NotFound />
  return <>{children}</>
}

function RouteFallback() {
  return <BootExperience compact />
}

function AuthUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="fixed inset-0 bg-black flex items-center justify-center px-6 text-white">
      <section className="max-w-sm text-center" role="alert">
        <div className="mx-auto mb-5 h-2 w-2 rounded-full bg-amber-300/70" />
        <h1 className="font-serif text-xl">No pudimos verificar tu sesión</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Tu cuenta y tus libros siguen intactos. Revisa la conexión e inténtalo nuevamente.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-full border border-white/20 px-5 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white"
        >
          Reintentar
        </button>
      </section>
    </main>
  )
}

function MotionPreferences({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "user"}>
      {children}
    </MotionConfig>
  )
}

function AppContent() {
  const { isLoading, isLoggedIn, authError, retryAuth } = useAuth()
  const [hasBootedThisSession] = useState(
    () => hasSessionValue(BOOT_SESSION_KEY) || hasSessionValue(LEGACY_SPLASH_KEY),
  )
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading")
  const [bootComplete, setBootComplete] = useState(false)
  const legalPath = window.location.pathname === "/privacy"
    ? "privacy"
    : window.location.pathname === "/terms" ? "terms" : null

  useEffect(() => {
    if (bootComplete) return

    let slowTimer: ReturnType<typeof setTimeout> | undefined
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let exitTimer: ReturnType<typeof setTimeout> | undefined

    if (isLoading) {
      slowTimer = setTimeout(() => setBootPhase("slow"), SLOW_BOOT_MS)
    } else {
      const elapsed = typeof performance === "undefined" ? 0 : performance.now()
      const wait = Math.max(0, minimumBootDuration(hasBootedThisSession) - elapsed)
      readyTimer = setTimeout(() => {
        setBootPhase("ready")
        exitTimer = setTimeout(() => {
          rememberBoot()
          setBootComplete(true)
        }, BOOT_EXIT_MS)
      }, wait)
    }

    return () => {
      if (slowTimer) clearTimeout(slowTimer)
      if (readyTimer) clearTimeout(readyTimer)
      if (exitTimer) clearTimeout(exitTimer)
    }
  }, [bootComplete, hasBootedThisSession, isLoading])

  // Al abrir la app logueado: juntar racha y progreso con la nube (una vez)
  useEffect(() => {
    if (isLoggedIn) {
      void pullAndMerge().catch(error => {
        console.warn("No se pudo sincronizar el progreso al iniciar", error)
      })
    }
  }, [isLoggedIn])

  const [showOnboarding, setShowOnboarding] = useState(
    needsOnboarding
  )

  if (legalPath) return <Suspense fallback={<RouteFallback />}><LegalPage kind={legalPath} /></Suspense>
  if (!bootComplete) return <BootExperience phase={bootPhase} />
  if (isLoading) return <RouteFallback />
  if (authError) return <AuthUnavailable onRetry={() => { void retryAuth() }} />

  // No está logueado — mostrar pantalla de login
  if (!isLoggedIn) return <LoginScreen />

  return (
    <>
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
      <ExperienceShell>
        <Router />
      </ExperienceShell>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsProvider>
          <MotionPreferences>
            <MusicProvider>
             <GenreProvider>
              {/* El visor de tarjetas vive arriba de todo: cualquier carta,
                  en cualquier pantalla, se toca y se abre aquí. */}
              <CardViewerProvider>
                <Toaster />
                <AppContent />
              </CardViewerProvider>
             </GenreProvider>
            </MusicProvider>
          </MotionPreferences>
        </SettingsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
