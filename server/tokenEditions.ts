import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { books, bookRevisions, bookTokens, licensedEditions, printCopies, type Book } from "@shared/schema"
import type { PublicationAcceptance } from "@shared/legal"
import { publicationWorkHash } from "./editionFingerprint"

/** Called with the current book row locked, before charging or opening checkout. */
export async function freezeLicensedEdition(tx: any, book: Book, acceptanceId: number, rights: PublicationAcceptance["choices"]) {
  const [edition] = await tx.insert(licensedEditions).values({
    bookId: book.id, bookRevision: book.revision, acceptanceId,
    workHash: publicationWorkHash(book), snapshot: book, rights,
  }).onConflictDoNothing().returning()
  const retained = edition ?? (await tx.select().from(licensedEditions).where(and(
    eq(licensedEditions.bookId, book.id), eq(licensedEditions.bookRevision, book.revision),
  )))[0]
  if (!retained || retained.workHash !== publicationWorkHash(book) || retained.acceptanceId !== acceptanceId) {
    throw new Error("La edición autorizada cambió; vuelve a iniciar la compra.")
  }
  return retained as typeof licensedEditions.$inferSelect
}

export async function tokenEdition(token: { bookId: number; editionId?: number | null }, tx: any) {
  if (token.editionId) {
    const [edition] = await tx.select().from(licensedEditions).where(and(
      eq(licensedEditions.id, token.editionId), eq(licensedEditions.bookId, token.bookId),
    ))
    return edition?.snapshot as Book | undefined
  }
  // Historic paid licences have no fabricated snapshot or newly inferred rights.
  const [book] = await tx.select().from(books).where(eq(books.id, token.bookId))
  if (!book || book.status === "published") return book as Book | undefined
  // A withdrawal must never make a later private manuscript printable.
  const [released] = await tx.select({ snapshot: bookRevisions.snapshot }).from(bookRevisions)
    .where(and(eq(bookRevisions.bookId, token.bookId), sql`${bookRevisions.snapshot}->>'status' = 'published'`))
    .orderBy(desc(bookRevisions.revision)).limit(1)
  return released?.snapshot as Book | undefined
}

/** A seller's refund never reassigns a legitimate third party's digital claim. */
export async function purchasedEditions(userId: number, bookIds: number[], tx: any) {
  const result = new Map<number, typeof licensedEditions.$inferSelect>()
  if (!bookIds.length) return result
  const rows = await tx.select({ edition: licensedEditions }).from(bookTokens)
    .innerJoin(licensedEditions, eq(bookTokens.editionId, licensedEditions.id))
    .leftJoin(printCopies, eq(printCopies.tokenId, bookTokens.id))
    .where(and(inArray(bookTokens.bookId, bookIds), or(
      and(eq(bookTokens.kind, "support"), eq(bookTokens.ownerUserId, userId), eq(bookTokens.licenseStatus, "active")),
      and(eq(printCopies.claimedByUserId, userId), or(eq(bookTokens.licenseStatus, "active"), sql`${bookTokens.ownerUserId} <> ${userId}`)),
    ))).orderBy(asc(bookTokens.id))
  for (const { edition } of rows) {
    if (edition.workHash !== publicationWorkHash(edition.snapshot)) throw new Error("La edición adquirida no supera la verificación de integridad")
    if (!result.has(edition.bookId)) result.set(edition.bookId, edition)
  }
  return result
}
