const keys = ["visualQuality", "visualAuto", "visualEssential", "visualPremium", "visualUltra", "orbTheme", "orbSingularity", "orbRose", "visualPremiumRequired", "visualFallback", "portalView", "portalHint", "carouselPrevious", "carouselNext", "visualFramePreview"] as const
const rows = {
  es: ["Calidad visual", "Automática", "Esencial", "Alta", "Ultra", "Orbe personal", "Singularidad", "Rosa fluorescente", "Incluido en Estético y Audio Premium", "Presentación esencial activa; tus funciones siguen disponibles.", "Vista inmersiva", "Desliza sobre la pieza para explorar su profundidad", "Libros anteriores", "Libros siguientes", "Explorar marco"],
  en: ["Visual quality", "Automatic", "Essential", "High", "Ultra", "Personal orb", "Singularity", "Fluorescent rose", "Included in Aesthetic and Audio Premium", "Essential presentation active; all functions remain available.", "Immersive view", "Drag across the piece to explore its depth", "Previous books", "Next books", "Explore frame"],
  fr: ["Qualité visuelle", "Automatique", "Essentielle", "Élevée", "Ultra", "Orbe personnel", "Singularité", "Rose fluorescente", "Inclus dans Esthétique et Audio Premium", "Affichage essentiel actif ; toutes les fonctions restent disponibles.", "Vue immersive", "Glissez sur la pièce pour explorer sa profondeur", "Livres précédents", "Livres suivants", "Explorer le cadre"],
  de: ["Bildqualität", "Automatisch", "Einfach", "Hoch", "Ultra", "Persönliche Kugel", "Singularität", "Fluoreszierende Rose", "In Ästhetik und Audio Premium enthalten", "Einfache Darstellung aktiv; alle Funktionen bleiben verfügbar.", "Immersive Ansicht", "Über das Objekt streichen, um die Tiefe zu erkunden", "Vorherige Bücher", "Nächste Bücher", "Rahmen erkunden"],
  it: ["Qualità visiva", "Automatica", "Essenziale", "Alta", "Ultra", "Sfera personale", "Singolarità", "Rosa fluorescente", "Incluso in Estetico e Audio Premium", "Presentazione essenziale attiva; tutte le funzioni restano disponibili.", "Vista immersiva", "Scorri sull’oggetto per esplorarne la profondità", "Libri precedenti", "Libri successivi", "Esplora cornice"],
  pt: ["Qualidade visual", "Automática", "Essencial", "Alta", "Ultra", "Orbe pessoal", "Singularidade", "Rosa fluorescente", "Incluído em Estético e Audio Premium", "Apresentação essencial ativa; todas as funções continuam disponíveis.", "Vista imersiva", "Deslize sobre a peça para explorar a profundidade", "Livros anteriores", "Próximos livros", "Explorar moldura"],
  ja: ["画質", "自動", "基本", "高画質", "ウルトラ", "オーブ", "特異点", "蛍光のバラ", "Estético と Audio Premium に含まれます", "基本表示中です。すべての機能を利用できます。", "没入型ビュー", "作品をドラッグして奥行きを楽しむ", "前の本", "次の本", "フレームを見る"],
  zh: ["画面质量", "自动", "基础", "高", "超高", "个人光球", "奇点", "荧光玫瑰", "包含于 Estético 和 Audio Premium", "基础显示已启用，所有功能仍可使用。", "沉浸视图", "在作品上拖动以探索深度", "之前的书", "之后的书", "查看边框"],
  ar: ["جودة العرض", "تلقائية", "أساسية", "عالية", "فائقة", "الكرة الشخصية", "التفرّد", "وردة متوهجة", "مضمّن في Estético وAudio Premium", "العرض الأساسي مفعّل وجميع الوظائف متاحة.", "عرض غامر", "اسحب على القطعة لاستكشاف عمقها", "الكتب السابقة", "الكتب التالية", "استكشاف الإطار"],
}
export const VISUAL_STRINGS = Object.fromEntries(Object.entries(rows).map(([language, values]) => [language, Object.fromEntries(keys.map((key, i) => [key, values[i]]))])) as Record<keyof typeof rows, Record<string, string>>

const additions = {
  es: ["Original", "Portal", "Estudio 3D del material. Los ornamentos y efectos originales se conservan en la galería."],
  en: ["Original", "Portal", "3D material study. Original ornaments and effects remain in the gallery."],
  fr: ["Original", "Portail", "Étude du matériau en 3D. Les ornements et effets originaux restent dans la galerie."],
  de: ["Original", "Portal", "3D-Materialstudie. Originalverzierungen und Effekte bleiben in der Galerie erhalten."],
  it: ["Originale", "Portale", "Studio del materiale in 3D. Ornamenti ed effetti originali restano nella galleria."],
  pt: ["Original", "Portal", "Estudo do material em 3D. Os ornamentos e efeitos originais permanecem na galeria."],
  ja: ["オリジナル", "ポータル", "3D素材プレビュー。元の装飾と効果はギャラリーに残ります。"],
  zh: ["原版", "传送门", "3D材质预览。原有装饰和特效保留在图库中。"],
  ar: ["الأصل", "البوابة", "معاينة ثلاثية الأبعاد للمادة. تبقى الزخارف والتأثيرات الأصلية في المعرض."],
}
for (const language of Object.keys(additions) as Array<keyof typeof additions>) {
  const [visualOriginal, visualPortal, visualFrameMaterialNote] = additions[language]
  Object.assign(VISUAL_STRINGS[language], { visualOriginal, visualPortal, visualFrameMaterialNote })
}
