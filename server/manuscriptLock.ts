import { sql } from "drizzle-orm"

/** Canonical updates, recovery drafts and deletion share one lock order. */
export async function lockManuscript(tx: any, bookId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(84673, ${bookId})`)
}
