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
import SplashScreen from "@/components/SplashScreen"
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
const AuthorPage = lazy(() => import("@/pages/author"))
const ClaimPage = lazy(() => import("@/pages/claim"))
const FrameWorkshop = lazy(() => import("@/pages/FrameWorkshop"))
const FrameGallery = lazy(() => import("@/pages/FrameGallery"))
const CardStudio = lazy(() => import("@/pages/CardStudio"))
const GachaScreen = lazy(() => import("@/pages/GachaScreen"))
const FlickerLab = lazy(() => import("@/pages/FlickerLab"))
const AudioCatalogAdmin = lazy(() => import("@/pages/AudioCatalogAdmin"))
const ProfileHub = lazy(() => import("@/pages/ProfileHub"))
const Inbox = lazy(() => import("@/pages/Inbox"))
const Editions = lazy(() => import("@/pages/Editions"))
const AdminHub = lazy(() => import("@/pages/AdminHub"))
import { CardViewerProvider } from "@/components/CardViewer"
import { MusicProvider } from "@/audio/MusicProvider"

const SESSION_KEY = "novareads_splash_shown"

function Router() {
  const adminPage = (Page: ComponentType<any>) => () => <AdminOnly><Page /></AdminOnly>
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/"                        component={Home}     />
        <Route path="/library"                 component={Library}  />
        <Route path="/book/:id"                component={BookPage} />
        <Route path="/read/:bookId/:chapterId" component={Reader}   />
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
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 px-6 text-center" role="status" aria-live="polite">
      <div className="w-2 h-2 rounded-full animate-pulse bg-violet-300/60" />
      <p className="text-xs tracking-[0.22em] uppercase text-white/45">Iniciando Tloque</p>
    </div>
  )
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

  // Al abrir la app logueado: juntar racha y progreso con la nube (una vez)
  useEffect(() => {
    if (isLoggedIn) {
      void pullAndMerge().catch(error => {
        console.warn("No se pudo sincronizar el progreso al iniciar", error)
      })
    }
  }, [isLoggedIn])

  const [showSplash,     setShowSplash]     = useState(
    () => !sessionStorage.getItem(SESSION_KEY)
  )
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem("novareads_onboarding_done")
  )

  if (isLoading) return <RouteFallback />
  if (authError) return <AuthUnavailable onRetry={() => { void retryAuth() }} />

  // No está logueado — mostrar pantalla de login
  if (!isLoggedIn) return <LoginScreen />

  return (
    <>
      {showSplash && (
        <SplashScreen onComplete={() => {
          sessionStorage.setItem(SESSION_KEY, "1")
          setShowSplash(false)
        }} />
      )}
      {!showSplash && showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
      <Router />
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
