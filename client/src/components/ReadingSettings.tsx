import AccessibleDialog from "./AccessibleDialog"
import { useSettings, READING_MODE_BG, READING_MODE_TEXT } from "@/context/SettingsContext"
import { X } from "lucide-react"

export default function ReadingSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSetting, t } = useSettings()
  return <AccessibleDialog open={open} onClose={onClose} title={t("sectionReading")} className="max-w-lg">
    <header className="flex shrink-0 items-center justify-between p-5"><h2 className="text-lg">{t("sectionReading")}</h2><button aria-label={t("closeAction")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/25" onClick={onClose}><X size={20} /></button></header>
    <div className="min-h-0 space-y-6 overflow-y-auto px-5 pb-5">
      <fieldset><legend className="mb-2 text-sm text-zinc-200">{t("backgroundLabel")}</legend><div className="grid grid-cols-3 gap-2">{(["night", "twilight", "dawn"] as const).map(mode => <button key={mode} className="min-h-11 rounded-xl border px-2 py-3 text-sm aria-pressed:ring-2 aria-pressed:ring-violet-300" aria-pressed={settings.readingMode === mode} onClick={() => updateSetting("readingMode", mode)} style={{ background: READING_MODE_BG[mode], color: READING_MODE_TEXT[mode] }}>{t(`reading${mode[0].toUpperCase()}${mode.slice(1)}`)}</button>)}</div></fieldset>
      <fieldset><legend className="mb-2 text-sm text-zinc-200">{t("textSize")}</legend><div className="grid grid-cols-3 gap-2">{(["small", "medium", "large"] as const).map(size => <button key={size} className="min-h-11 rounded-xl border border-white/25 px-2 py-3 text-sm aria-pressed:bg-violet-300/20" aria-pressed={settings.fontSize === size} onClick={() => updateSetting("fontSize", size)}>{t(`fontSize${size[0].toUpperCase()}${size.slice(1)}`)}</button>)}</div></fieldset>
      <fieldset><legend className="mb-2 text-sm text-zinc-200">{t("spacingLabel")}</legend><div className="grid grid-cols-3 gap-2">{(["compact", "normal", "relaxed"] as const).map(space => <button key={space} className="min-h-11 rounded-xl border border-white/25 px-2 py-3 text-sm aria-pressed:bg-violet-300/20" aria-pressed={settings.lineSpacing === space} onClick={() => updateSetting("lineSpacing", space)}>{t(`spacing${space[0].toUpperCase()}${space.slice(1)}`)}</button>)}</div></fieldset>
    </div>
  </AccessibleDialog>
}
