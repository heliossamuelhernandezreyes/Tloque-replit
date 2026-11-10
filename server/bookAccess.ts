import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { bookCards, bookRevisions, unlockedBooks, userCards } from "@shared/schema"
import { db } from "./db"
import { hasCapability } from "./principalPermissions"
import { purchasedEditions } from "./tokenEditions"
import { isEditionRestricted, withoutPremiumArt } from "@shared/edition-access"
export { withoutPremiumArt } from "@shared/edition-access"

export function canEditBookFor(user: any, book: any): boolean {
  return !!user && (hasCapability(user, "manageCatalog") || (!!book?.authorId && book.authorId === user.id))
}

export function canViewBookFor(user: any, book: any): boolean {
  return (book?.status === "published" && !isEditionRestricted(book)) || canEditBookFor(user, book)
}

export async function entitledBookIdsFor(user: any, catalog: Array<{ id: number; authorId?: number | null }>, tx: any = db): Promise<Set<number>> {
  if (!user || !catalog.length) return new Set()
  if (hasCapability(user, "manageCatalog")) return new Set(catalog.map(book => book.id))
  const ids = catalog.map(book => book.id)
  const allowed = new Set(catalog.filter(book => book.authorId === user.id).map(book => book.id))
  const [unlocked, cards] = await Promise.all([
    tx.select({ bookId: unlockedBooks.bookId }).from(unlockedBooks)
      .where(and(eq(unlockedBooks.userId, user.id), inArray(unlockedBooks.bookId, ids))),
    tx.select({ bookId: bookCards.bookId }).from(userCards).innerJoin(bookCards, eq(userCards.cardId, bookCards.id))
      .where(and(eq(userCards.userId, user.id), inArray(bookCards.bookId, ids))),
  ])
  for (const row of unlocked) allowed.add(row.bookId)
  for (const row of cards) if (row.bookId != null) allowed.add(row.bookId)
  return allowed
}

/** Text, derived audio and import previews resolve the same acquired edition.
 * Legacy acquisitions keep their public-history fallback; no new rights are inferred. */
export async function readableEditionsFor(user: any, catalog: any[], entitled?: Set<number>, tx: any = db): Promise<any[]> {
  const allowed = entitled ?? await entitledBookIdsFor(user, catalog, tx)
  const acquired = user ? await purchasedEditions(user.id, catalog.map(book => book.id), tx) : new Map()
  const withdrawn = catalog.filter(book => !canViewBookFor(user, book) && !isEditionRestricted(book) && allowed.has(book.id))
  const editions = withdrawn.length ? await tx.selectDistinctOn([bookRevisions.bookId], {
    bookId: bookRevisions.bookId, snapshot: bookRevisions.snapshot,
  }).from(bookRevisions).where(and(inArray(bookRevisions.bookId, withdrawn.map(book => book.id)),
    sql`${bookRevisions.snapshot}->>'status' = 'published'`))
    .orderBy(bookRevisions.bookId, desc(bookRevisions.revision)) : []
  const snapshots = new Map(editions.map((edition: any) => [edition.bookId, edition.snapshot]))
  return catalog.flatMap(book => {
    if (isEditionRestricted(book) && !canEditBookFor(user, book)) return []
    const edition = acquired.get(book.id)
    if (edition && !isEditionRestricted(book) && !canEditBookFor(user, book)) {
      return [{ ...edition.snapshot, acquiredEditionId: edition.id, withdrawn: book.status !== "published" }]
    }
    return canViewBookFor(user, book) ? [book] : snapshots.has(book.id)
      ? [{ ...(snapshots.get(book.id) as object), rightsHold: book.rightsHold, withdrawn: true }] : []
  })
}

export async function publicBookFor(user: any, book: any, tx: any = db) {
  const [edition] = await readableEditionsFor(user, [book], undefined, tx)
  if (!edition) return null
  return withoutPremiumArt(edition, (await entitledBookIdsFor(user, [edition], tx)).has(edition.id))
}
