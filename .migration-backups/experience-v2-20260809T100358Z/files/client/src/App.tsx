import { useState, useEffect } from "react"
import { Switch, Route } from "wouter"
import { queryClient } from "./lib/queryClient"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { GenreProvider } from "@/context/GenreContext"
import { SettingsProvider } from "@/context/SettingsContext"
import SplashScreen from "@/components/SplashScreen"
import Onboarding  from "@/components/Onboarding"
import LoginScreen from "@/components/LoginScreen"
import { useAuth } from "@/hooks/useAuth"
import { pullAndMerge } from "@/lib/sync"

import NotFound  from "@/pages/not-found"
import Home      from "@/pages/home"
import Library   from "@/pages/library"
import Reader    from "@/pages/reader"
import BookPage  from "@/pages/book"
import Editor    from "@/pages/editor"
import AuthorPage from "@/pages/author"
import ClaimPage from "@/pages/claim"
import FrameWorkshop from "@/pages/FrameWorkshop"
import FrameGallery from "@/pages/FrameGallery"
import CardStudio from "@/pages/CardStudio"
import GachaScreen from "@/pages/GachaScreen"
import FlickerLab from "@/pages/FlickerLab"
import { CardViewerProvider } from "@/components/CardViewer"

const SESSION_KEY = "novareads_splash_shown"

function Router() {
  return (
    <Switch>
      <Route path="/"                        component={Home}     />
      <Route path="/library"                 component={Library}  />
      <Route path="/book/:id"                component={BookPage} />
      <Route path="/read/:bookId/:chapterId" component={Reader}   />
      <Route path="/editor"                  component={Editor}     />
      <Route path="/author/:name"             component={AuthorPage} />
      <Route path="/claim/:folio"             component={ClaimPage} />
      <Route path="/sorteo"                   component={GachaScreen} />
      <Route path="/diag"                     component={FlickerLab} />
      <Route path="/tarjetas"                 component={CardStudio} />
      <Route path="/tarjetas/:bookId"         component={CardStudio} />
      <Route path="/marcos"                   component={FrameGallery} />
      <Route path="/admin/marcos"             component={FrameWorkshop} />
      <Route component={NotFound} />
    </Switch>
  )
}

function AppContent() {
  const { isLoading, isLoggedIn } = useAuth()

  // Al abrir la app logueado: juntar racha y progreso con la nube (una vez)
  useEffect(() => {
    if (isLoggedIn) pullAndMerge()
  }, [isLoggedIn])

  const [showSplash,     setShowSplash]     = useState(
    () => !sessionStorage.getItem(SESSION_KEY)
  )
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem("novareads_onboarding_done")
  )

  // Mientras verifica si hay sesión activa — pantalla negra mínima
  if (isLoading) return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div
        className="w-2 h-2 rounded-full animate-pulse"
        style={{ background: "rgba(160,160,255,0.4)" }}
      />
    </div>
  )

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
          <GenreProvider>
            {/* El visor de tarjetas vive arriba de todo: cualquier carta,
                en cualquier pantalla, se toca y se abre aquí. */}
            <CardViewerProvider>
              <Toaster />
              <AppContent />
            </CardViewerProvider>
          </GenreProvider>
        </SettingsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
