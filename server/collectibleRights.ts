import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "./db"
import { books, bookCards, userCards, unlockedBooks } from "@shared/schema"
import { rightsForBooks } from "./legal"

/** New benefits require current permission; previously delivered snapshots remain. */
export async function grantAuthorizedSupportCards(userId: number, bookIds: number[], database: typeof db = db) {
  if (!bookIds.length) return
  await database.transaction(async tx => {
    const unlocked = await tx.select().from(unlockedBooks).where(and(eq(unlockedBooks.userId, userId), eq(unlockedBooks.source, "support"), inArray(unlockedBooks.bookId, bookIds)))
    if (!unlocked.length) return
    // Acquired historical benefits are preserved. For this policy's new patronage,
    // only Tinta support grants the author's configured support cards.
    const eligible = await tx.execute(sql`select id from unlocked_books u where user_id=${userId}
      and source='support' and book_id in (${sql.join(bookIds.map(id => sql`${id}`), sql`,`)})
      and not exists (select 1 from token_orders o where o.user_id=u.user_id and o.book_id=u.book_id
        and o.kind='support' and o.purchase_terms->>'rewardPolicy'='tinta-patronage-only-v1'
        and o.provider <> 'tinta' and o.status='paid')`)
    const eligibleIds = new Set(eligible.rows.map((row: any) => row.id))
    const eligibleBooks = unlocked.filter(row => eligibleIds.has(row.id)).map(row => row.bookId)
    if (!eligibleBooks.length) return
    const editions = await tx.select().from(books).where(and(inArray(books.id, eligibleBooks), eq(books.status, "published"))).for("share")
    const rights = await rightsForBooks(editions, tx)
    const allowed = editions.filter(book => rights.get(book.id)?.collectibles).map(book => book.id)
    if (!allowed.length) return
    const cards = await tx.select().from(bookCards).where(and(inArray(bookCards.bookId, allowed), eq(bookCards.unlock, "support"), eq(bookCards.archived, false)))
    if (cards.length) await tx.insert(userCards).values(cards.map(card => ({ userId, cardId: card.id, source: "support" }))).onConflictDoNothing()
  })
}
