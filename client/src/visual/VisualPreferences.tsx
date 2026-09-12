import { useSettings } from "@/context/SettingsContext"
import { useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { allowedOrbTheme, normalizeVisualQuality } from "@shared/visual-experience"
import VisualSlot, { useVisualEngine } from "./VisualEngine"
import VisualDialog from "./VisualDialog"

export default function VisualPreferences() {
  const { settings, updateSetting, t } = useSettings()
  const { user } = useAuth()
  const { failed, theme } = useVisualEngine()
  const [preview, setPreview] = useState(false), [active, setActive] = useState(false)
  const rose = allowedOrbTheme("fluorescent-rose", user?.visualEntitlements) === "fluorescent-rose"
  return <div className="tq-visual-preferences">
    <label className="block text-sm text-white/80">{t("visualQuality")}
      <select value={settings.visualQuality} onChange={event => updateSetting("visualQuality", normalizeVisualQuality(event.target.value))} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 p-3 text-base text-white">
        {(["auto", "essential", "premium", "ultra"] as const).map((quality, i) => <option key={quality} value={quality}>{t(["visualAuto", "visualEssential", "visualPremium", "visualUltra"][i])}</option>)}
      </select>
    </label>
    <label className="mt-4 block text-sm text-white/80">{t("orbTheme")}
      <select value={rose ? settings.orbTheme : "singularity"} onChange={event => updateSetting("orbTheme", event.target.value === "fluorescent-rose" && rose ? "fluorescent-rose" : "singularity")} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 p-3 text-base text-white">
        <option value="singularity">{t("orbSingularity")}</option>
        <option value="fluorescent-rose" disabled={!rose}>{t("orbRose")}{!rose ? " · Premium" : ""}</option>
      </select>
    </label>
    <p className="mt-2 text-xs leading-relaxed text-white/60">{t("visualPremiumRequired")}</p>
    <button className="mt-4 min-h-11 w-full rounded-xl border border-white/20 text-sm text-white/80" onClick={() => { setActive(false); setPreview(true) }}>Explorar el orbe</button>
    <VisualDialog open={preview} onClose={() => setPreview(false)} title={theme === "singularity" ? t("orbSingularity") : t("orbRose")}>
      <div className="mx-auto w-full max-w-lg text-center text-zinc-300">
        <VisualSlot priority={100} options={{ kind: "orb", theme, active, color: "#c9b58c" }} interactive className="h-[360px] w-full" label={t("orbTheme")}>
          <div className="m-auto h-40 w-40 rounded-full border-4 border-amber-200/60 bg-black shadow-[0_0_55px_#c9a84c44]"/>
        </VisualSlot>
        <h2 className="font-display text-2xl">{theme === "singularity" ? t("orbSingularity") : t("orbRose")}</h2>
        <p className="my-4 text-sm leading-6 text-zinc-400">{theme === "singularity" ? "Disco de acreción turbulento, anillo de luz y lente gravitacional estilizada. La energía responde al estado del orbe." : "Pétalos curvados y articulados que se despliegan desde su centro luminoso."}</p>
        <button aria-pressed={active} onClick={() => setActive(value => !value)} className="min-h-11 rounded-full border border-white/25 px-6 text-sm">{active ? "Volver al reposo" : "Activar el orbe"}</button>
      </div>
    </VisualDialog>
    {failed && <p role="status" className="mt-2 text-xs text-amber-200">{t("visualFallback")}</p>}
  </div>
}
