import { db } from "./db";
import { books, comments, type CreateBookRequest, type UpdateBookRequest, type BookResponse, type Comment } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  getBooks(): Promise<BookResponse[]>;
  getBook(id: number): Promise<BookResponse | undefined>;
  createBook(book: CreateBookRequest): Promise<BookResponse>;
  updateBook(id: number, updates: UpdateBookRequest): Promise<BookResponse>;
  deleteBook(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getBooks(): Promise<BookResponse[]> {
    // Solo devolver libros publicados en el lobby — los borradores
    // son locales en el cliente y nunca suben al servidor
    return await db.select().from(books).where(eq(books.status, "published"))
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
    await db.delete(books).where(eq(books.id, id));
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
