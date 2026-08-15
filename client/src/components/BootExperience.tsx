import { motion } from "framer-motion"
import { useSettings } from "@/context/SettingsContext"

export type BootPhase = "loading" | "slow" | "ready"

export default function BootExperience({
  phase = "loading",
  compact = false,
}: {
  phase?: BootPhase
  compact?: boolean
}) {
  const { t } = useSettings()

  if (compact) {
    return (
      <div className="tloque-route-loader" role="status" aria-live="polite">
        <BootMark phase={phase} compact />
        <span className="sr-only">{t("loadingLabel")}</span>
      </div>
    )
  }

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{
        opacity: phase === "ready" ? 0 : 1,
        scale: phase === "ready" ? 1.015 : 1,
      }}
      transition={{ duration: phase === "ready" ? 0.48 : 0.28, ease: "easeOut" }}
      className={`tloque-boot ${phase === "ready" ? "is-ready" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={phase !== "ready"}
    >
      <div className="tloque-boot__glow" aria-hidden="true" />
      <BootMark phase={phase} />
      <div className="tloque-boot__copy">
        <h1>Tloque</h1>
        <p>{phase === "slow" ? t("loadingLabel") : "narrativas que permanecen"}</p>
      </div>
    </motion.main>
  )
}

function BootMark({ phase, compact = false }: { phase: BootPhase; compact?: boolean }) {
  return (
    <div
      className={`tloque-boot-mark ${compact ? "is-compact" : ""} ${phase === "ready" ? "is-ready" : ""}`}
      aria-hidden="true"
    >
      <span className="tloque-boot-ring tloque-boot-ring--outer" />
      <span className="tloque-boot-ring tloque-boot-ring--inner" />
      <span className="tloque-boot-iris"><span /></span>
      <i className="tloque-boot-star tloque-boot-star--one" />
      <i className="tloque-boot-star tloque-boot-star--two" />
      <i className="tloque-boot-star tloque-boot-star--three" />
    </div>
  )
}
