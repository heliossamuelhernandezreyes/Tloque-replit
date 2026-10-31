import { and, eq, inArray } from "drizzle-orm"
import { db } from "./db"
import { books, bookCards, userCards, unlockedBooks } from "@shared/schema"
import { rightsForBooks } from "./legal"

/** New benefits require current permission; previously delivered snapshots remain. */
export async function grantAuthorizedSupportCards(userId: number, bookIds: number[], database: typeof db = db) {
  if (!bookIds.length) return
  await database.transaction(async tx => {
    const unlocked = await tx.select().from(unlockedBooks).where(and(eq(unlockedBooks.userId, userId), eq(unlockedBooks.source, "support"), inArray(unlockedBooks.bookId, bookIds)))
    if (!unlocked.length) return
    const editions = await tx.select().from(books).where(and(inArray(books.id, unlocked.map(row => row.bookId)), eq(books.status, "published"))).for("share")
    const rights = await rightsForBooks(editions, tx)
    const allowed = editions.filter(book => rights.get(book.id)?.collectibles).map(book => book.id)
    if (!allowed.length) return
    const cards = await tx.select().from(bookCards).where(and(inArray(bookCards.bookId, allowed), eq(bookCards.unlock, "support"), eq(bookCards.archived, false)))
    if (cards.length) await tx.insert(userCards).values(cards.map(card => ({ userId, cardId: card.id, source: "support" }))).onConflictDoNothing()
  })
}
