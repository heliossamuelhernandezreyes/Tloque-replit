import { db } from "./db"
import { sql } from "drizzle-orm"
import { RARITIES, type RarityKey } from "@shared/gacha"

// ─────────────────────────────────────────────────────────────
// LA RAREZA NO SE COMPRA: SE GANA
//
// El marco se compra con Tinta. La rareza, no. La rareza sale de
// lo que la obra logró de verdad:
//
//   RETENCIÓN (50%) — ¿la gente TERMINA tu libro? Es la señal más
//                     difícil de falsear. Las vistas se compran con bots;
//                     terminar un libro, no.
//   APOYO     (30%) — ¿cuántos lectores lo desbloquearon o apoyaron?
//   ALCANCE   (12%) — lectores únicos que lo abrieron.
//   GUARDADOS  (8%) — cuántos lo guardaron para después.
//
// Y se mide por PERCENTIL dentro del catálogo, no con números fijos.
// Eso resuelve el arranque en frío: el día 1, con 10 obras, el mejor
// 1% sigue siendo el mejor 1%. Tloque nunca se queda sin rarezas altas.
// ─────────────────────────────────────────────────────────────

export const WEIGHTS = {
  retention: 0.50,
  support:   0.30,
  reach:     0.12,
  saves:     0.08,
} as const

// Percentil mínimo para desbloquear cada rareza (0.99 = top 1%)
export const RARITY_GATES: { key: RarityKey; minPercentile: number }[] = [
  { key: "absolute",  minPercentile: 0.99 },   // el 1% de las obras de Tloque
  { key: "mythic",    minPercentile: 0.97 },
  { key: "legendary", minPercentile: 0.93 },
  { key: "golden",    minPercentile: 0.85 },
  { key: "unusual",   minPercentile: 0.70 },
  { key: "very_rare", minPercentile: 0.50 },
  { key: "rare",      minPercentile: 0.25 },
  { key: "common",    minPercentile: 0.00 },   // siempre disponible
]

// ── LA ESCALERA DEL AUTOR ─────────────────────────────────
// El cupo no es fijo: se GANA. Cada escalón desbloquea más cartas
// y mejores rarezas. Un autor inédito tiene 2 comunes y nada más.
// Uno consagrado puede vestir oro. Solo el 0.5% toca lo Absoluto.
export interface Rung {
  minPct: number
  name:   string
  quotas: Partial<Record<RarityKey, number>>   // cupo BASE (el de un libro)
}

export const LADDER: Rung[] = [
  // El arranque ya es digno: un libro nace con 4 comunes (un cuento, 2).
  { minPct: 0.000, name: "Inédito",    quotas: { common: 4 } },
  { minPct: 0.300, name: "Leído",      quotas: { common: 4, rare: 2 } },
  { minPct: 0.550, name: "Seguido",    quotas: { common: 4, rare: 2, very_rare: 1 } },
  { minPct: 0.720, name: "Querido",    quotas: { common: 4, rare: 3, very_rare: 2, unusual: 1 } },
  { minPct: 0.860, name: "Celebrado",  quotas: { common: 4, rare: 3, very_rare: 2, unusual: 2, golden: 1 } },
  { minPct: 0.940, name: "Consagrado", quotas: { common: 4, rare: 3, very_rare: 2, unusual: 2, golden: 1, legendary: 1 } },
  { minPct: 0.975, name: "Legendario", quotas: { common: 4, rare: 3, very_rare: 2, unusual: 2, golden: 2, legendary: 1, mythic: 1 } },
  { minPct: 0.995, name: "Absoluto",   quotas: { common: 4, rare: 3, very_rare: 2, unusual: 2, golden: 2, legendary: 1, mythic: 1, absolute: 1 } },
]

// El TAMAÑO de la obra escala el cupo. Un cuento no puede sostener
// tantas cartas como una saga: la obra tiene que dar para ellas.
export const TYPE_SCALE: Record<string, number> = {
  story: 0.5,   // cuento → la mitad
  book:  1.0,   // libro  → la base
  saga:  1.5,   // saga   → una vez y media
}

/** El escalón de una obra según su percentil. */
export function rungFor(percentile: number): Rung {
  let out = LADDER[0]
  for (const r of LADDER) if (percentile >= r.minPct) out = r
  return out
}

/** El cupo REAL: escalón × tamaño de la obra. */
export function quotasFor(percentile: number, bookType: string): Record<RarityKey, number> {
  const rung = rungFor(percentile)
  const scale = TYPE_SCALE[bookType] ?? 1.0
  const out = {} as Record<RarityKey, number>
  for (const r of RARITIES) {
    const base = rung.quotas[r.key] ?? 0
    // Si el escalón la desbloqueó, siempre queda al menos 1 (redondeo hacia arriba
    // en los escasos, para que un cuento consagrado no pierda su Dorada).
    out[r.key] = base > 0 ? Math.max(1, Math.round(base * scale)) : 0
  }
  return out
}

export interface BookScore {
  bookId:      number
  authorId:    number | null
  title:       string
  retention:   number      // 0..1 — qué fracción de lectores lo terminó
  support:     number      // lectores que lo desbloquearon
  reach:       number      // lectores únicos
  saves:       number      // veces guardado
  score:       number      // 0..1 — el compuesto por percentiles
  percentile:  number      // 0..1 — su lugar en el catálogo
  ceiling:     RarityKey   // la rareza MÁXIMA que puede vestir
  floor:       RarityKey   // la MÍNIMA (por el precio del libro)
}

/** Convierte una lista de valores en percentiles (0..1). Empates comparten percentil. */
function toPercentiles(values: number[]): number[] {
  const n = values.length
  if (n <= 1) return values.map(() => n === 1 ? 0.5 : 0)
  const sorted = [...values].sort((a, b) => a - b)
  return values.map(v => {
    // fracción de valores estrictamente menores + la mitad de los iguales
    let less = 0, equal = 0
    for (const s of sorted) {
      if (s < v) less++
      else if (s === v) equal++
    }
    return (less + equal / 2) / n
  })
}

function ceilingFor(percentile: number): RarityKey {
  for (const g of RARITY_GATES) {
    if (percentile >= g.minPercentile) return g.key
  }
  return "common"
}

export function floorFor(priceTinta: number): RarityKey {
  for (const rarity of RARITIES) {
    if (rarity.sellable && rarity.priceMax != null && priceTinta <= rarity.priceMax) {
      return rarity.key
    }
  }
  return "legendary"
}

/** ¿Puede esta obra vestir una carta de rareza X, y le queda cupo? */
export function canUseRarity(
  rarity: RarityKey,
  percentile: number,
  bookType: string,
  yaEnUso: number,
): { ok: boolean; quota: number; why?: string } {
  const quotas = quotasFor(percentile, bookType)
  const quota = quotas[rarity] ?? 0
  const rung = rungFor(percentile)
  if (quota === 0) {
    const nombre = RARITIES.find(r => r.key === rarity)?.name ?? rarity
    return { ok: false, quota: 0,
      why: `«${nombre}» aún no está a tu alcance. Tu obra está en el escalón «${rung.name}»: la rareza se gana con lectores que TERMINAN tu historia.` }
  }
  if (yaEnUso >= quota) {
    return { ok: false, quota,
      why: `Cupo lleno: ${quota} carta${quota > 1 ? "s" : ""} de esa rareza para esta obra.` }
  }
  return { ok: true, quota }
}

/**
 * Calcula el score de TODAS las obras publicadas y lo persiste.
 * Pensado para correr periódicamente (o al pedido del admin).
 */
export async function computeAllScores(): Promise<BookScore[]> {
  // Métricas crudas por obra. reading_progress.book_id es TEXTO: se castea.
  const raw: any = await db.execute(sql`
    with caps as (
      select id,
             greatest(1, coalesce(jsonb_array_length(chapters), 1)) as total_caps
      from books where status = 'published'
    ),
    lectura as (
      select c.id as bid,
             count(*)                                             as lectores,
             count(*) filter (where rp.max_chapter + 1 >= c.total_caps) as terminaron
      from reading_progress rp
      join caps c on rp.book_id = c.id::text
      group by c.id
    ),
    apoyo as (
      select book_id as bid, count(*) as n from unlocked_books group by book_id
    ),
    guardados as (
      select book_id as bid, count(*) as n from saved_books group by book_id
    )
    select b.id, b.author_id, b.title,
           coalesce(l.lectores, 0)   as lectores,
           coalesce(l.terminaron, 0) as terminaron,
           coalesce(a.n, 0)          as apoyo,
           coalesce(g.n, 0)          as guardados
    from books b
    left join lectura l   on l.bid = b.id
    left join apoyo a     on a.bid = b.id
    left join guardados g on g.bid = b.id
    where b.status = 'published'
  `)
  const rows = raw?.rows ?? []
  if (!rows.length) return []

  const retention = rows.map((r: any) =>
    Number(r.lectores) > 0 ? Number(r.terminaron) / Number(r.lectores) : 0)
  const support = rows.map((r: any) => Number(r.apoyo))
  const reach   = rows.map((r: any) => Number(r.lectores))
  const saves   = rows.map((r: any) => Number(r.guardados))

  const pR = toPercentiles(retention)
  const pS = toPercentiles(support)
  const pA = toPercentiles(reach)
  const pG = toPercentiles(saves)

  const scores = rows.map((_: any, i: number) =>
    WEIGHTS.retention * pR[i] + WEIGHTS.support * pS[i] +
    WEIGHTS.reach * pA[i] + WEIGHTS.saves * pG[i])

  // El percentil del score compuesto: su lugar real en el catálogo
  const pFinal = toPercentiles(scores)

  const out: BookScore[] = rows.map((r: any, i: number) => ({
    bookId:   Number(r.id),
    authorId: r.author_id != null ? Number(r.author_id) : null,
    title:    String(r.title ?? ""),
    retention: retention[i],
    support:   support[i],
    reach:     reach[i],
    saves:     saves[i],
    score:     scores[i],
    percentile: pFinal[i],
    ceiling:   ceilingFor(pFinal[i]),
    floor:     "common",   // se resuelve con el precio, que vive fuera de esta tabla
  }))

  // Persistir en books (para que el autor lo vea sin recalcular)
  for (const s of out) {
    await db.execute(sql`
      update books
      set gacha_score = ${s.score}, rarity_ceiling = ${s.ceiling}
      where id = ${s.bookId}
    `)
  }
  return out
}
