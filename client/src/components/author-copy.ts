import type { AppLanguage } from "@/context/SettingsContext"

const es = {
  classic: "Autor clásico", community: "Autor de Tloque", works: "Obras en Tloque",
  search: "Buscar una obra por título", clear: "Limpiar búsqueda",
  noWorks: "Este autor todavía no tiene obras publicadas.", noMatches: "Ninguna obra coincide con esa búsqueda.",
  more: "Cargar más obras", notFound: "Perfil de autor no encontrado",
  gutenberg: "Más ediciones en Gutenberg", dates: "Fechas según Project Gutenberg",
}

const copies: Record<AppLanguage, typeof es> = {
  es,
  en: {
    classic: "Classic author", community: "Tloque author", works: "Works on Tloque",
    search: "Find a work by title", clear: "Clear search",
    noWorks: "This author has yet to publish a work.", noMatches: "No works match that search.",
    more: "Load more works", notFound: "Author profile unavailable",
    gutenberg: "More editions on Gutenberg", dates: "Dates from Project Gutenberg",
  },
  fr: {
    classic: "Auteur classique", community: "Auteur sur Tloque", works: "Œuvres sur Tloque",
    search: "Chercher une œuvre par titre", clear: "Effacer la recherche",
    noWorks: "Cet auteur n’a pas encore publié d’œuvre.", noMatches: "Aucune œuvre ne correspond à cette recherche.",
    more: "Charger plus d’œuvres", notFound: "Profil d’auteur introuvable",
    gutenberg: "Autres éditions sur Gutenberg", dates: "Dates selon le Projet Gutenberg",
  },
  de: {
    classic: "Klassischer Autor", community: "Autor auf Tloque", works: "Werke auf Tloque",
    search: "Werk nach Titel suchen", clear: "Suche löschen",
    noWorks: "Dieser Autor hat noch keine Werke veröffentlicht.", noMatches: "Keine Werke entsprechen der Suche.",
    more: "Weitere Werke laden", notFound: "Autorenprofil nicht gefunden",
    gutenberg: "Weitere Ausgaben bei Gutenberg", dates: "Jahresangaben laut Project Gutenberg",
  },
  it: {
    classic: "Autore classico", community: "Autore su Tloque", works: "Opere su Tloque",
    search: "Cerca un’opera per titolo", clear: "Cancella ricerca",
    noWorks: "Questo autore non ha ancora pubblicato opere.", noMatches: "Nessuna opera corrisponde alla ricerca.",
    more: "Carica altre opere", notFound: "Profilo dell’autore non trovato",
    gutenberg: "Altre edizioni su Gutenberg", dates: "Date da Project Gutenberg",
  },
  pt: {
    classic: "Autor clássico", community: "Autor no Tloque", works: "Obras no Tloque",
    search: "Buscar uma obra por título", clear: "Limpar busca",
    noWorks: "Este autor ainda não publicou obras.", noMatches: "Nenhuma obra corresponde à busca.",
    more: "Carregar mais obras", notFound: "Perfil do autor não encontrado",
    gutenberg: "Mais edições no Gutenberg", dates: "Datas segundo o Projeto Gutenberg",
  },
  ja: {
    classic: "古典作家", community: "Tloqueの作家", works: "Tloqueの作品",
    search: "作品名で検索", clear: "検索をクリア",
    noWorks: "この作家の公開作品はまだありません。", noMatches: "検索に一致する作品はありません。",
    more: "さらに作品を表示", notFound: "作家プロフィールが見つかりません",
    gutenberg: "Gutenbergの他の版", dates: "生没年の出典はプロジェクト・グーテンベルク",
  },
  zh: {
    classic: "经典作家", community: "Tloque 作者", works: "Tloque 上的作品",
    search: "按书名搜索作品", clear: "清除搜索",
    noWorks: "该作者尚未发表作品。", noMatches: "没有符合搜索条件的作品。",
    more: "加载更多作品", notFound: "找不到作者资料",
    gutenberg: "在 Gutenberg 查找更多版本", dates: "生卒年份来自古腾堡计划",
  },
  ar: {
    classic: "مؤلف كلاسيكي", community: "مؤلف على Tloque", works: "الأعمال على Tloque",
    search: "ابحث عن عمل حسب العنوان", clear: "مسح البحث",
    noWorks: "لم ينشر هذا المؤلف أي عمل بعد.", noMatches: "لا توجد أعمال تطابق هذا البحث.",
    more: "عرض المزيد من الأعمال", notFound: "لم يتم العثور على ملف المؤلف",
    gutenberg: "طبعات أخرى في غوتنبرغ", dates: "التواريخ من مشروع غوتنبرغ",
  },
}

export const authorCopy = (language: AppLanguage) => copies[language]
