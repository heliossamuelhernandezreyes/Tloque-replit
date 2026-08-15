import { db } from "./db"
import { sql, eq, and } from "drizzle-orm"
import {
  gachaConfig, gachaPity, gachaDraws, gachaExclusions,
  bookCards, books, userCards, walletLedger,
} from "@shared/schema"
import {
  RARITIES, drawRarity, nextPity,
  type RarityKey,
} from "@shared/gacha"
import { randomBytes } from "node:crypto"

// Un candado global para el pozo: dos lectores no pueden cobrarle
// al mismo tiempo. Serializa las tiradas — a cambio, el dinero nunca miente.
const POOL_LOCK = 918_273_645

// Un sorteo con valor económico no puede depender de Math.random(). Seis
// bytes dan 48 bits uniformes y se convierten en el intervalo [0, 1).
export function secureDrawRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 0x1_0000_0000_0000
}

export type DrawOutcome =
  | { ok: true; result: DrawPayload }
  | { ok: false; code: 401 | 402 | 404 | 503; message: string; extra?: any }

export interface DrawPayload {
  drawId:       number
  rarity:       RarityKey
  rolledRarity: RarityKey
  reason:       string
  pityApplied:  boolean
  card:         { id: number; name: string; subtitle: string; fx: any }
  book:         { id: number; title: string; author: string; coverUrl: string }
  isDuplicate:  boolean
  bookGranted:  boolean       // ¿se sumó el libro a su biblioteca?
  paperGranted: number        // compatibilidad histórica; nuevas tiradas siempre 0
  authorPaid:   number        // Tinta que cobró el autor (directo + bono)
  poolAfter:    number
  pity:         { sinceGolden: number; sinceLegendary: number }
}

/**
 * UNA TIRADA. Todo ocurre dentro de una transacción con candado:
 * o pasa entero, o no pasa nada. El pozo nunca queda inconsistente.
 */
export async function drawTicket(userId: number): Promise<DrawOutcome> {
  return await db.transaction(async (tx) => {
    // ── Candados: primero el usuario, luego el pozo (orden fijo = sin abrazos mortales)
    await tx.execute(sql`select pg_advisory_xact_lock(${userId})`)
    await tx.execute(sql`select pg_advisory_xact_lock(${POOL_LOCK})`)

    // ── 1. La configuración y EL INTERRUPTOR
    const [cfg] = await tx.select().from(gachaConfig).where(eq(gachaConfig.id, 1))
    if (!cfg || !cfg.enabled) {
      return { ok: false as const, code: 503 as const, message: "El sorteo aún no está abierto" }
    }
    const price  = cfg.ticketPrice
    const direct = cfg.splitDirect
    const toPool = cfg.splitPool
    const house  = cfg.splitHouse
    // Invariante #1, verificado en caliente por si alguien tocó la config a mano
    if (price <= 0 || direct < 0 || toPool < 0 || house < 0
        || cfg.poolBalance < 0 || direct + toPool + house !== price) {
      return { ok: false as const, code: 503 as const, message: "Configuración del sorteo inválida" }
    }

    // ── 2. Cobrar el boleto. El insert SOLO ocurre si el saldo alcanza.
    const charged: any = await tx.execute(sql`
      insert into wallet_ledger (user_id, currency, delta, reason, ref_type, ref_id)
      select ${userId}, 'tinta', ${-price}, 'gacha_ticket', 'gacha', 0
      where (select coalesce(sum(delta), 0) from wallet_ledger
             where user_id = ${userId} and currency = 'tinta') >= ${price}
      returning id
    `)
    if ((charged?.rows?.length ?? 0) === 0) {
      const bal: any = await tx.execute(sql`
        select coalesce(sum(delta), 0) as b from wallet_ledger
        where user_id = ${userId} and currency = 'tinta'
      `)
      const balance = Number(bal?.rows?.[0]?.b ?? 0)
      return {
        ok: false as const, code: 402 as const, message: "tinta_insuficiente",
        extra: { needed: price, balance, missing: Math.max(0, price - balance) },
      }
    }

    // ── 3. Los géneros que este lector NO quiere que le toquen
    const [exc] = await tx.select().from(gachaExclusions).where(eq(gachaExclusions.userId, userId))
    const excluded: string[] = Array.isArray(exc?.genres) ? (exc!.genres as string[]) : []

    // ── 4. ¿Qué rarezas tienen cartas disponibles para ESTE lector?
    const stock: any = await tx.execute(sql`
      select c.rarity, count(distinct c.book_id) as obras
      from book_cards c
      join books b on b.id = c.book_id
      where c.in_gacha_pool = true
        and b.status = 'published'
        and c.book_id is not null
        ${excluded.length ? sql`and coalesce(b.genre, '') <> all(${excluded})` : sql``}
      group by c.rarity
    `)
    const available = {} as Record<RarityKey, boolean>
    for (const r of RARITIES) available[r.key] = false
    for (const row of (stock?.rows ?? [])) {
      if (Number(row.obras) > 0) available[row.rarity as RarityKey] = true
    }
    if (!Object.values(available).some(Boolean)) {
      // No hay NADA que sortear: devolvemos la Tinta y avisamos.
      await tx.insert(walletLedger).values({
        userId, currency: "tinta", delta: price, reason: "refund",
        refType: "gacha", refId: 0,
      })
      return { ok: false as const, code: 404 as const, message: "No hay cartas en el sorteo todavía" }
    }

    // ── 5. Piedad del lector
    const [pityRow] = await tx.select().from(gachaPity).where(eq(gachaPity.userId, userId))
    const pg0 = pityRow?.sinceGolden ?? 0
    const pl0 = pityRow?.sinceLegendary ?? 0

    // ── 6. EL SORTEO (núcleo puro, con solvencia y stock)
    const poolBefore = cfg.poolBalance + toPool   // el boleto ya alimentó el pozo
    const draw = drawRarity({
      poolBalance: poolBefore,
      pitySinceGolden: pg0,
      pitySinceLegendary: pl0,
      available,
      rng: secureDrawRandom,
    })
    const bonus = draw.bonus

    // ── 7. Elegir OBRA (uniforme entre obras, NO entre cartas:
    //      así el autor con más HISTORIAS tiene más presencia, no el que hace más cartas)
    // Preferir una obra con alguna carta de esa rareza que el lector aún no
    // tenga. La sorpresa se conserva sin fabricar Papel ni castigar con un
    // duplicado cuando todavía hay algo nuevo disponible.
    let obras: any = await tx.execute(sql`
      select candidates.book_id
      from (
        select distinct c.book_id
        from book_cards c
        join books b on b.id = c.book_id
        where c.in_gacha_pool = true and c.rarity = ${draw.rarity}
          and b.status = 'published' and c.book_id is not null
          and not exists (
            select 1 from user_cards uc
            where uc.user_id = ${userId} and uc.card_id = c.id
          )
          ${excluded.length ? sql`and coalesce(b.genre, '') <> all(${excluded})` : sql``}
      ) candidates
      order by random() limit 1
    `)
    if (!(obras?.rows?.length ?? 0)) {
      obras = await tx.execute(sql`
        select candidates.book_id
        from (
          select distinct c.book_id
          from book_cards c
          join books b on b.id = c.book_id
          where c.in_gacha_pool = true and c.rarity = ${draw.rarity}
            and b.status = 'published' and c.book_id is not null
            ${excluded.length ? sql`and coalesce(b.genre, '') <> all(${excluded})` : sql``}
        ) candidates
        order by random() limit 1
      `)
    }
    const bookId = Number(obras?.rows?.[0]?.book_id)
    if (!bookId) {
      await tx.insert(walletLedger).values({
        userId, currency: "tinta", delta: price, reason: "refund", refType: "gacha", refId: 0,
      })
      return { ok: false as const, code: 404 as const, message: "No hay obras con esa rareza" }
    }

    // ── 8. Elegir CARTA dentro de esa obra
    let cartas: any = await tx.execute(sql`
      select id from book_cards
      where in_gacha_pool = true and rarity = ${draw.rarity} and book_id = ${bookId}
        and not exists (
          select 1 from user_cards uc
          where uc.user_id = ${userId} and uc.card_id = book_cards.id
        )
      order by random() limit 1
    `)
    if (!(cartas?.rows?.length ?? 0)) {
      cartas = await tx.execute(sql`
        select id from book_cards
        where in_gacha_pool = true and rarity = ${draw.rarity} and book_id = ${bookId}
        order by random() limit 1
      `)
    }
    const cardId = Number(cartas?.rows?.[0]?.id)

    const [card] = await tx.select().from(bookCards).where(eq(bookCards.id, cardId))
    const [book] = await tx.select().from(books).where(eq(books.id, bookId))
    const authorId = book?.authorId ?? null

    // ── 9. ¿Ya la tenía?
    const [dup] = await tx.select().from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)))
    const isDuplicate = !!dup

    // ── 10. Mover el pozo. El CHECK de la base impide que quede negativo.
    const poolAfter = poolBefore - bonus
    await tx.update(gachaConfig)
      .set({ poolBalance: poolAfter, updatedAt: new Date() })
      .where(eq(gachaConfig.id, 1))

    // ── 11. Pagar al autor: lo directo del boleto + el bono del pozo
    const authorPaid = direct + bonus
    if (authorId && authorPaid > 0) {
      await tx.insert(walletLedger).values({
        userId: authorId, currency: "tinta", delta: authorPaid,
        reason: "gacha_earning", refType: "gacha_card", refId: cardId,
      })
    }

    // ── 12. Entregar. Papel pertenece exclusivamente al consumo de IA.
    const paperGranted = 0
    let bookGranted = false
    if (!isDuplicate) {
      await tx.insert(userCards).values({ userId, cardId, source: "gacha" })
      // El libro entra a su biblioteca (si no lo tenía ya)
      const granted: any = await tx.execute(sql`
        insert into unlocked_books (user_id, book_id, source)
        values (${userId}, ${bookId}, 'gacha')
        on conflict on constraint uniq_user_unlocked do nothing
        returning id
      `)
      bookGranted = (granted?.rows?.length ?? 0) > 0
    }

    // ── 13. Actualizar la piedad
    const np = nextPity(draw.rarity, pg0, pl0)
    await tx.execute(sql`
      insert into gacha_pity (user_id, since_golden, since_legendary, total_draws, updated_at)
      values (${userId}, ${np.sinceGolden}, ${np.sinceLegendary}, 1, now())
      on conflict (user_id) do update set
        since_golden = ${np.sinceGolden},
        since_legendary = ${np.sinceLegendary},
        total_draws = gacha_pity.total_draws + 1,
        updated_at = now()
    `)

    // ── 14. El libro de auditoría. Los CHECK de la base verifican la matemática.
    const [rec] = await tx.insert(gachaDraws).values({
      userId, cardId, bookId, authorId,
      rarity: draw.rarity,
      rolledRarity: draw.rolled,
      reason: draw.reason,
      ticketPrice: price,
      paidDirect: direct,
      paidPool: toPool,
      paidHouse: house,
      bonusFromPool: bonus,
      poolBefore,
      poolAfter,
      wasDuplicate: isDuplicate,
      paperGranted,
      bookGranted,
    }).returning()

    return {
      ok: true as const,
      result: {
        drawId: rec.id,
        rarity: draw.rarity,
        rolledRarity: draw.rolled,
        reason: draw.reason,
        pityApplied: draw.pityApplied,
        card: { id: cardId, name: card?.name ?? "", subtitle: card?.subtitle ?? "", fx: card?.fx ?? {} },
        book: { id: bookId, title: book?.title ?? "", author: book?.author ?? "", coverUrl: book?.coverUrl ?? "" },
        isDuplicate,
        bookGranted,
        paperGranted,
        authorPaid,
        poolAfter,
        pity: { sinceGolden: np.sinceGolden, sinceLegendary: np.sinceLegendary },
      },
    }
  })
}
