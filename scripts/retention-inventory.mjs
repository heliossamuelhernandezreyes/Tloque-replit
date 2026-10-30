// Read-only database inventory. Counts are not a decision to retain or erase.
export async function retentionInventory(client, userId) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("userId debe ser un entero positivo")
  const { rows: users } = await client.query("SELECT id, deleted_at FROM users WHERE id = $1", [userId])
  if (!users.length) throw new Error("Cuenta no encontrada")
  const { rows: links } = await client.query(`
    SELECT DISTINCT relation.relname AS table_name, attribute.attname AS column_name,
      target.relname AS target_name
    FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_class target ON target.oid = constraint_row.confrelid
    CROSS JOIN LATERAL unnest(constraint_row.conkey) key_column(number)
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.number
    WHERE constraint_row.contype = 'f' AND namespace.nspname = 'public'
      AND constraint_row.confrelid IN ('public.users'::regclass, 'public.books'::regclass)
    ORDER BY relation.relname, attribute.attname
  `)
  const quote = identifier => '"' + identifier.replaceAll('"', '""') + '"'
  const counts = []
  for (const link of links) {
    const predicate = link.target_name === "users" ? "$1" : "(SELECT id FROM books WHERE author_id = $1)"
    const operator = link.target_name === "users" ? "=" : "IN"
    const result = await client.query(`SELECT count(*)::integer AS count FROM public.${quote(link.table_name)} WHERE ${quote(link.column_name)} ${operator} ${predicate}`, [userId])
    counts.push({ table: link.table_name, relation: link.column_name, scope: link.target_name === "users" ? "direct-account-link" : "authored-work-link", rows: result.rows[0].count })
  }
  return {
    schema: "tloque-retention-inventory@1", generatedAt: new Date().toISOString(),
    userId, accountClosed: users[0].deleted_at != null, mode: "read-only", executedDeletions: 0,
    counts,
    limits: ["Counts may overlap; do not add them as distinct records.", "Only declared foreign keys in the current database are inventoried.",
      "No external objects, provider copies, backups, session JSON or unlinked email requests were inspected.",
      "No legal basis, deadline, identity verification or right to erase is inferred from these counts."],
    nextStep: "Document category, purpose, legal basis, minimum retained fields, hold, deadline and execution verification before a separate purge procedure.",
  }
}
