import { useSettings } from "@/context/SettingsContext"
import { useAuth } from "@/hooks/useAuth"
import { allowedOrbTheme, normalizeVisualQuality } from "@shared/visual-experience"
import { useVisualEngine } from "./VisualEngine"

export default function VisualPreferences() {
  const { settings, updateSetting, t } = useSettings()
  const { user } = useAuth()
  const { failed } = useVisualEngine()
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
    {failed && <p role="status" className="mt-2 text-xs text-amber-200">{t("visualFallback")}</p>}
  </div>
}
