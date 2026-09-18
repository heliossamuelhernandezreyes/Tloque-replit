import { sql } from "drizzle-orm"

// Existing third-party claims survive a seller's payment incident. The buyer's
// own support/claim entitlement must still have an active licence behind it.
export async function syncOwnerUnlock(executor: any, userId: number, bookId: number) {
  const result = await executor.execute(sql`
    select case
      when exists (select 1 from book_tokens where owner_user_id = ${userId}
        and book_id = ${bookId} and kind = 'support' and license_status = 'active') then 'support'
      when exists (select 1 from print_copies c join book_tokens t on t.id = c.token_id
        where c.claimed_by_user_id = ${userId} and t.book_id = ${bookId}
        and (t.license_status = 'active' or t.owner_user_id <> ${userId})) then 'claim'
      else null end as source
  `)
  const source = result.rows[0]?.source
  if (source) {
    await executor.execute(sql`
      insert into unlocked_books(user_id, book_id, source) values (${userId}, ${bookId}, ${source})
      on conflict (user_id, book_id) do update set source = excluded.source
      where unlocked_books.source in ('support', 'claim')
    `)
  } else {
    await executor.execute(sql`delete from unlocked_books where user_id = ${userId}
      and book_id = ${bookId} and source in ('support', 'claim')`)
  }
}
