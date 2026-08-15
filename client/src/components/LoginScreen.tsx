import { motion } from "framer-motion"
import { useAuth } from "@/hooks/useAuth"

// Pantalla de login — se muestra si el usuario no está autenticado
export default function LoginScreen() {
  const { loginWithGoogle } = useAuth()

  return (
    <div className="fixed inset-0 z-[500] bg-black flex flex-col items-center justify-center px-8">

      {/* fondo sutil */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.06, 0.14, 0.06] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute w-96 h-96 rounded-full blur-3xl"
          style={{
            background: "radial-gradient(circle, #7070ee, transparent 70%)",
            top: "20%", left: "50%", transform: "translateX(-50%)",
          }}
        />
      </div>

      {/* logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 text-center mb-16"
      >
        <h1
          className="text-5xl tracking-[0.15em] font-display font-bold mb-3"
          style={{
            backgroundImage:
              "linear-gradient(110deg, #6e6e76 0%, #b8b8c2 20%, #ffffff 45%, #c4c4cf 60%, #8a8a93 80%, #5c5c64 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 22px rgba(200,200,225,0.25))",
          }}
        >
          Tloque
        </h1>
        <p
          className="text-[11px] tracking-[0.3em] uppercase font-sans"
          style={{ color: "rgba(255,255,255,0.25)" }}
        >
          narrativas que permanecen
        </p>
      </motion.div>

      {/* descripción */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="text-zinc-500 text-sm font-sans text-center leading-relaxed mb-10 max-w-xs relative z-10"
      >
        Inicia sesión para guardar tus lecturas, publicar historias y personalizar tu experiencia.
      </motion.p>

      {/* botón Google */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={loginWithGoogle}
        className="relative z-10 flex items-center gap-3 px-6 py-3.5 rounded-2xl font-sans font-medium text-sm transition-all"
        style={{
          background:  "rgba(255,255,255,0.06)",
          border:      "1px solid rgba(255,255,255,0.12)",
          color:       "rgba(255,255,255,0.85)",
          boxShadow:   "0 4px 24px rgba(0,0,0,0.4)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* ícono de Google */}
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar con Google
      </motion.button>

      {/* nota de privacidad */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-6 text-zinc-700 text-[10px] font-sans text-center max-w-xs relative z-10"
      >
        Solo usamos tu nombre y correo para identificarte. No compartimos tu información.
      </motion.p>

    </div>
  )
}
