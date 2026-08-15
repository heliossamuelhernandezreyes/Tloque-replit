// Re-exporta todo desde el contexto global
// Mantiene compatibilidad con imports existentes
export {
  useSettings,
  SettingsProvider,
  DEFAULTS,
  READING_MODE_LABELS,
  READING_MODE_BG,
  READING_MODE_TEXT,
  READING_MODE_HEADER_BG,
  READING_MODE_HEADER_TEXT,
  FONT_SIZE_PX,
  FONT_SIZE_LABELS,
  LINE_SPACING_VALUE,
  LANGUAGE_LABELS,
  UI_STRINGS,
  type Settings,
  type ReadingMode,
  type FontSize,
  type LineSpacing,
  type AppLanguage,
} from "@/context/SettingsContext"
