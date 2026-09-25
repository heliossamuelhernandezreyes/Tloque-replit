import { db } from "./db";
import { isDeepStrictEqual } from "node:util"
import { books, bookRevisions, comments, type CreateBookRequest, type UpdateBookRequest, type BookResponse, type Comment } from "@shared/schema";
import { eq, and, desc, getTableColumns, inArray, sql } from "drizzle-orm";

export type BookChangeType = "create" | "update" | "publish" | "unpublish" | "restore" | "delete"

export class BookRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("El manuscrito cambió en otra sesión")
    this.name = "BookRevisionConflictError"
  }
}

type BookUpdateOptions = {
  expectedRevision?: number
  changedBy?: number | null
  changeType?: BookChangeType
}

export interface IStorage {
  getBooks(options?: { before?: number; limit?: number; author?: string }): Promise<any[]>;
  getBooksByAuthor(authorId: number): Promise<any[]>;
  getBook(id: number): Promise<BookResponse | undefined>;
  findBookByGutenbergId(gutenbergId: number): Promise<BookResponse | undefined>;
  getGutenbergReferences(ids: number[], includeUnpublished?: boolean): Promise<{ id: number; gutenbergId: number | null; status: string }[]>;
  createBook(book: CreateBookRequest): Promise<BookResponse>;
  updateBook(id: number, updates: UpdateBookRequest, options?: BookUpdateOptions): Promise<BookResponse>;
  deleteBook(id: number, changedBy?: number | null): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getBooks(options: { before?: number; limit?: number; author?: string } = {}): Promise<any[]> {
    // El catálogo es una vista ligera: mandar el texto y todos los capítulos
    // de cada obra hacía crecer el primer arranque con toda la biblioteca.
    // El contenido completo se obtiene únicamente al abrir /api/books/:id.
    const { content: _content, chapters: _chapters, ...summaryColumns } = getTableColumns(books)
    return await db.select({
      ...summaryColumns,
      chapterCount: sql<number>`case
        when jsonb_typeof(${books.chapters}) = 'array' then jsonb_array_length(${books.chapters})
        when length(${books.content}) > 0 then 1 else 0 end`,
      openingLine: sql<string>`left(coalesce(nullif(${books.chapters}->0->>'content', ''), ${books.content}, ''), 320)`,
    }).from(books).where(and(eq(books.status, "published"),
      options.before ? sql`${books.id} < ${options.before}` : undefined,
      options.author ? sql`lower(${books.author}) = lower(${options.author})` : undefined,
    )).orderBy(desc(books.id)).limit(Math.min(100, Math.max(1, options.limit || 50)))
  }

  async getBooksByAuthor(authorId: number): Promise<any[]> {
    const { content: _content, chapters: _chapters, ...summaryColumns } = getTableColumns(books)
    return db.select({
      ...summaryColumns,
      chapterCount: sql<number>`case
        when jsonb_typeof(${books.chapters}) = 'array' then jsonb_array_length(${books.chapters})
        when length(${books.content}) > 0 then 1 else 0 end`,
      openingLine: sql<string>`left(coalesce(nullif(${books.chapters}->0->>'content', ''), ${books.content}, ''), 320)`,
    }).from(books).where(and(
      eq(books.authorId, authorId),
      sql`${books.status} <> 'deleted'`,
    )).orderBy(desc(books.updatedAt))
  }

  async getBook(id: number): Promise<BookResponse | undefined> {
    const [book] = await db.select().from(books).where(eq(books.id, id));
    return book;
  }

  async findBookByGutenbergId(gutenbergId: number): Promise<BookResponse | undefined> {
    const [book] = await db.select().from(books).where(eq(books.gutenbergId, gutenbergId)).limit(1);
    return book;
  }

  async getGutenbergReferences(ids: number[], includeUnpublished = false) {
    if (!ids.length) return []
    return db.select({ id: books.id, gutenbergId: books.gutenbergId, status: books.status })
      .from(books).where(and(
        inArray(books.gutenbergId, ids.slice(0, 32)),
        includeUnpublished ? undefined : eq(books.status, "published"),
      ))
  }

  async createBook(insertBook: CreateBookRequest): Promise<BookResponse> {
    return db.transaction(async tx => {
      const [book] = await tx.insert(books).values({ ...insertBook, revision: 1, updatedAt: new Date() }).returning();
      await tx.insert(bookRevisions).values({
        bookId: book.id,
        revision: book.revision,
        snapshot: book as unknown as Record<string, unknown>,
        changeType: "create",
        createdBy: book.authorId,
      })
      return book;
    })
  }

  async updateBook(id: number, updates: UpdateBookRequest, options: BookUpdateOptions = {}): Promise<BookResponse> {
    return db.transaction(async tx => {
      // revision y timestamps son propiedad del servidor, incluso para admin.
      const safeUpdates = { ...updates } as Record<string, unknown>
      delete safeUpdates.revision
      delete safeUpdates.createdAt
      delete safeUpdates.updatedAt

      const condition = options.expectedRevision === undefined
        ? eq(books.id, id)
        : and(eq(books.id, id), eq(books.revision, options.expectedRevision))
      const [currentBook] = await tx.select().from(books).where(condition).for("update")
      if (currentBook && Object.entries(safeUpdates).every(([key, value]) => value === undefined || isDeepStrictEqual((currentBook as any)[key], value))) return currentBook
      const [updated] = await tx.update(books)
        .set({
          ...safeUpdates,
          revision: sql`${books.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(condition)
        .returning()

      if (!updated) {
        const [current] = await tx.select({ revision: books.revision }).from(books).where(eq(books.id, id))
        if (current) throw new BookRevisionConflictError(current.revision)
        throw new Error("Book not found")
      }

      await tx.insert(bookRevisions).values({
        bookId: updated.id,
        revision: updated.revision,
        snapshot: updated as unknown as Record<string, unknown>,
        changeType: options.changeType ?? "update",
        createdBy: options.changedBy ?? null,
      })
      return updated
    })
  }

  async deleteBook(id: number, changedBy: number | null = null): Promise<void> {
    // Retiro lógico: las órdenes, ejemplares, cartas, desbloqueos y ganancias
    // conservan sus claves foráneas. La obra deja de ser pública sin destruir
    // el historial económico ni las colecciones de los lectores.
    await db.transaction(async tx => {
      const [updated] = await tx.update(books)
        .set({ status: "deleted", revision: sql`${books.revision} + 1`, updatedAt: new Date() })
        .where(eq(books.id, id))
        .returning()
      if (!updated) throw new Error("Book not found")
      await tx.insert(bookRevisions).values({
        bookId: updated.id,
        revision: updated.revision,
        snapshot: updated as unknown as Record<string, unknown>,
        changeType: "delete",
        createdBy: changedBy,
      })
    })
  }

  // ── COMENTARIOS ──────────────────────────────────────────
  async getComments(bookId: number, opts?: { chapterIndex?: number; includeHidden?: boolean }): Promise<Comment[]> {
    const conds = [eq(comments.bookId, bookId)]
    if (opts?.chapterIndex !== undefined) conds.push(eq(comments.chapterIndex, opts.chapterIndex))
    if (!opts?.includeHidden) conds.push(eq(comments.status, "visible"))
    return await db.select().from(comments)
      .where(and(...conds))
      .orderBy(desc(comments.createdAt))
  }

  async getComment(id: number): Promise<Comment | undefined> {
    const [c] = await db.select().from(comments).where(eq(comments.id, id))
    return c
  }

  async createComment(data: {
    bookId: number; chapterIndex: number; userId: number;
    userName: string; userAvatar: string; content: string;
  }): Promise<Comment> {
    const [c] = await db.insert(comments).values(data).returning()
    return c
  }

  async setCommentStatus(id: number, status: "visible" | "hidden"): Promise<Comment> {
    const [c] = await db.update(comments).set({ status }).where(eq(comments.id, id)).returning()
    return c
  }
}

export const storage = new DatabaseStorage();
