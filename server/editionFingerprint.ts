import { createHash } from "node:crypto"
import type { Book } from "@shared/schema"

export function publicationWorkHash(book: Book) {
  return createHash("sha256").update(JSON.stringify({
    id: book.id, authorId: book.authorId, title: book.title, author: book.author, type: book.type,
    content: book.content, chapters: book.chapters, coverUrl: book.coverUrl, coverFx: book.coverFx,
    backCoverUrl: book.backCoverUrl, premiumCoverUrl: book.premiumCoverUrl, premiumBackUrl: book.premiumBackUrl,
  })).digest("hex")
}
