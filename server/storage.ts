import { db } from "./db";
import { books, comments, type CreateBookRequest, type UpdateBookRequest, type BookResponse, type Comment } from "@shared/schema";
import { eq, and, desc, getTableColumns, sql } from "drizzle-orm";

export interface IStorage {
  getBooks(): Promise<any[]>;
  getBook(id: number): Promise<BookResponse | undefined>;
  createBook(book: CreateBookRequest): Promise<BookResponse>;
  updateBook(id: number, updates: UpdateBookRequest): Promise<BookResponse>;
  deleteBook(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getBooks(): Promise<any[]> {
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
    }).from(books).where(eq(books.status, "published"))
  }

  async getBook(id: number): Promise<BookResponse | undefined> {
    const [book] = await db.select().from(books).where(eq(books.id, id));
    return book;
  }

  async createBook(insertBook: CreateBookRequest): Promise<BookResponse> {
    const [book] = await db.insert(books).values(insertBook).returning();
    return book;
  }

  async updateBook(id: number, updates: UpdateBookRequest): Promise<BookResponse> {
    const [updated] = await db.update(books)
      .set(updates)
      .where(eq(books.id, id))
      .returning();
    return updated;
  }

  async deleteBook(id: number): Promise<void> {
    // Retiro lógico: las órdenes, ejemplares, cartas, desbloqueos y ganancias
    // conservan sus claves foráneas. La obra deja de ser pública sin destruir
    // el historial económico ni las colecciones de los lectores.
    await db.update(books)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(eq(books.id, id));
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
