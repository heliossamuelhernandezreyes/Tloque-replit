import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useGenre } from "@/context/GenreContext"
import { useSettings } from "@/context/SettingsContext"

interface Props {
  onComplete: () => void
}

// Steps are now generated with t() inside the component
const STEP_KEYS = [
  { icon: "✦", titleKey: "onboardingTitle1", bodyKey: "onboardingBody1", hintKey: null },
  { icon: "◉", titleKey: "onboardingTitle2", bodyKey: "onboardingBody2", hintKey: "onboardingHint2" },
  { icon: "✿", titleKey: "onboardingTitle3", bodyKey: "onboardingBody3", hintKey: null },
]

export default function Onboarding({ onComplete }: Props) {
  const [step,     setStep]     = useState(0)
  const [exiting,  setExiting]  = useState(false)
  const { cfg } = useGenre()
  const { t }   = useSettings()

  function next() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      finish()
    }
  }

  function finish() {
    setExiting(true)
    localStorage.setItem("novareads_onboarding_done", "1")
    setTimeout(onComplete, 600)
  }

  const STEPS = STEP_KEYS.map(s => ({
    icon: s.icon,
    title: t(s.titleKey),
    body:  t(s.bodyKey),
    hint:  s.hintKey ? t(s.hintKey) : null,
  }))
  const current = STEPS[step]

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[500] flex flex-col items-center justify-center px-8"
          style={{ background: "rgba(0,0,0,0.96)", backdropFilter: "blur(20px)" }}
        >
          {/* Fondo con partículas */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {Array.from({ length: 12 }, (_, i) => (
              <motion.div key={i}
                className="absolute w-1 h-1 rounded-full"
                style={{
                  background: cfg.color,
                  left: `${10 + i * 8}%`,
                  top:  `${15 + (i % 4) * 20}%`,
                }}
                animate={{
                  opacity: [0.1, 0.4, 0.1],
                  scale:   [0.8, 1.4, 0.8],
                  y:       [0, -12, 0],
                }}
                transition={{ duration: 3 + i * 0.3, repeat: Infinity, delay: i * 0.25 }}
              />
            ))}
          </div>

          {/* Contenido */}
          <div className="relative max-w-sm w-full text-center space-y-8">

            {/* Ícono */}
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: -20 }}
                transition={{ type: "spring", stiffness: 280, damping: 24 }}
                className="flex items-center justify-center"
              >
                <motion.span
                  className="text-5xl"
                  style={{ color: cfg.color }}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                >
                  {current.icon}
                </motion.span>
              </motion.div>
            </AnimatePresence>

            {/* Texto */}
            <AnimatePresence mode="wait">
              <motion.div key={`text-${step}`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                <h2 className="font-display font-bold text-white text-xl tracking-wide">
                  {current.title}
                </h2>
                <p className="text-zinc-400 text-sm font-sans leading-relaxed">
                  {current.body}
                </p>
                {current.hint && (
                  <p className="text-xs font-sans italic"
                    style={{ color: cfg.color + "88" }}>
                    {current.hint}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Indicadores de paso */}
            <div className="flex items-center justify-center gap-2">
              {STEPS.map((_, i) => (
                <motion.div key={i}
                  animate={{ width: i === step ? 20 : 6, opacity: i === step ? 1 : 0.3 }}
                  transition={{ duration: 0.3 }}
                  className="h-1.5 rounded-full"
                  style={{ background: cfg.color, minWidth: 6 }}
                />
              ))}
            </div>

            {/* Botones */}
            <div className="flex items-center justify-between gap-4">
              <button
                onClick={finish}
                className="text-xs font-sans text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Omitir
              </button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={next}
                className="flex-1 py-3.5 rounded-2xl font-sans font-semibold text-sm"
                style={{
                  background: `linear-gradient(135deg, ${cfg.bg}, rgba(0,0,0,0.4))`,
                  border:     `1px solid ${cfg.color}50`,
                  color:      cfg.color,
                  boxShadow:  `0 0 24px ${cfg.glow}30`,
                }}
              >
                {step < STEPS.length - 1 ? t("onboardingContinue") : t("onboardingStart")}
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
