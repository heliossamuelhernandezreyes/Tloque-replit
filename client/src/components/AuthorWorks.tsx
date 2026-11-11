import { useInfiniteQuery } from "@tanstack/react-query"
import { BookOpen, ExternalLink, Search, X } from "lucide-react"
import { useState, type ComponentProps } from "react"
import { Link } from "wouter"
import { gutenbergLanguageName } from "@shared/gutenberg"
import { accountFetch } from "@/lib/account-context"
import { useSettings } from "@/context/SettingsContext"
import { authorCopy } from "./author-copy"
import { BookCard } from "./book-card"
import QueryNotice from "./QueryNotice"

export type AuthorWork = ComponentProps<typeof BookCard> & {
  gutenbergId?: number | null
  originalLanguage?: string | null
  sourceMetadata?: Record<string, unknown>
}

export type AuthorWorksPage = {
  books: AuthorWork[]
  nextCursor: number | null
}

export default function AuthorWorks({ url, initialPage, isOwner }: {
  url: string; initialPage: AuthorWorksPage; isOwner: boolean
}) {
  const { settings, t } = useSettings()
  const copy = authorCopy(settings.language)
  const [input, setInput] = useState("")
  const [search, setSearch] = useState("")
  const catalog = useInfiniteQuery({
    queryKey: [url, search],
    initialPageParam: null as number | null,
    initialData: search ? undefined : { pages: [initialPage], pageParams: [null] },
    getNextPageParam: page => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }): Promise<AuthorWorksPage> => {
      const query = new URLSearchParams()
      if (search) query.set("q", search)
      if (pageParam) query.set("before", String(pageParam))
      const response = await accountFetch(url + "?" + query, { signal })
      if (!response.ok) throw new Error("author_works_unavailable")
      const data = await response.json()
      if (!Array.isArray(data?.books)) throw new Error("author_works_invalid")
      return data
    },
    staleTime: 120_000,
  })
  const works = catalog.data?.pages.flatMap(page => page.books) || []

  return <section aria-labelledby="author-works" className="mt-8 border-t border-white/10 pt-6">
    <h2 id="author-works" className="font-display text-2xl text-white">{copy.works}</h2>
    {(initialPage.books.length > 0 || search) && <form className="mt-4 flex max-w-xl gap-2" role="search" aria-label={copy.search}
      onSubmit={event => {
        event.preventDefault()
        const value = input.trim()
        if (value === search) void catalog.refetch()
        else setSearch(value)
      }}>
      <input type="search" aria-label={copy.search} placeholder={copy.search} maxLength={120} value={input}
        onChange={event => setInput(event.target.value)}
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/20 bg-white/5 px-3 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-amber-200" />
      <button type="submit" aria-label={copy.search} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/20 text-zinc-100 hover:bg-white/10">
        <Search className="h-4 w-4" />
      </button>
      {search && <button type="button" aria-label={copy.clear} onClick={() => { setInput(""); setSearch("") }}
        className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/20 text-zinc-100 hover:bg-white/10">
        <X className="h-4 w-4" />
      </button>}
    </form>}
    <QueryNotice loading={catalog.isPending} error={catalog.isError}
      onRetry={() => { void (catalog.isFetchNextPageError ? catalog.fetchNextPage() : catalog.refetch()) }} />
    {works.length > 0 && <div aria-busy={catalog.isFetching} className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      {works.map(work => <article key={work.id} className="min-w-0">
        <BookCard {...work} showAuthor={false} />
        {work.gutenbergId && <a href={`https://www.gutenberg.org/ebooks/${work.gutenbergId}`} target="_blank" rel="noreferrer"
          className="mt-1 inline-flex min-h-11 items-center gap-1 break-words text-xs text-amber-100/80 underline-offset-4 hover:underline">
          {work.originalLanguage && gutenbergLanguageName(work.originalLanguage) + " · "}Gutenberg #{work.gutenbergId}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>}
      </article>)}
    </div>}
    {!catalog.isPending && !catalog.isError && works.length === 0 && <div className="mt-5 flex flex-col items-start gap-3 rounded-2xl border border-white/10 p-5 text-zinc-300">
      <BookOpen className="h-6 w-6" aria-hidden="true" />
      <p role="status" className="text-sm">{search ? copy.noMatches : copy.noWorks}</p>
      {isOwner && !search && <Link href="/editor" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black">{t("writeNow")}</Link>}
    </div>}
    {catalog.hasNextPage && !catalog.isFetchNextPageError && <button type="button" disabled={catalog.isFetching}
      onClick={() => { void catalog.fetchNextPage() }}
      className="mt-6 min-h-11 rounded-xl border border-white/20 px-4 text-sm text-white hover:bg-white/10 disabled:opacity-60">
      {catalog.isFetchingNextPage ? t("searching") : copy.more}
    </button>}
  </section>
}
