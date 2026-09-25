import { accountFetch as fetch } from "@/lib/account-context"
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type BookInput, type BookUpdateInput } from "@shared/routes";
import { createAccountStore } from "@/lib/account-store";
import { AccountChangedError } from "@/lib/account-context"

// Initialize offline storage
const store = createAccountStore("books")

export class BookConflictError extends Error {
  constructor(
    message: string,
    public readonly currentRevision: number,
  ) {
    super(message)
    this.name = "BookConflictError"
  }
}

export function useBooks() {
  const query = useInfiniteQuery({
    queryKey: [api.books.list.path, "pages"],
    initialPageParam: "",
    getNextPageParam: (page: { books: any[]; next: string }) => page.next || undefined,
    queryFn: async ({ pageParam }) => {
      try {
        const res = await fetch(`${api.books.list.path}?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch books");
        const data = await res.json();

        // Cache for offline
        try { if (!pageParam) await store.setItem("books_list", data) }
        catch (error) { if (error instanceof AccountChangedError) throw error }
        return { books: data as any[], next: res.headers.get("X-Next-Cursor") || "" };
      } catch (error) {
        console.warn("Network fetch failed, attempting offline cache for list...");
        const cached = await store.getItem("books_list");
        if (cached && !pageParam) return { books: cached as any[], next: "" };
        throw error;
      }
    },
  });
  return { ...query, data: query.data?.pages.flatMap(page => page.books) }
}

export function useMyBooks() {
  return useQuery({
    queryKey: ["/api/books/mine"],
    queryFn: async () => {
      const response = await fetch("/api/books/mine", { credentials: "include" })
      if (!response.ok) throw new Error("No se pudieron cargar tus obras")
      return response.json() as Promise<any[]>
    },
  })
}

export function useBook(id: number | null) {
  return useQuery({
    queryKey: [api.books.get.path, id],
    queryFn: async () => {
      if (!id || isNaN(id)) return null
      const url = buildUrl(api.books.get.path, { id });
      try {
        const res = await fetch(url, { credentials: "include" });
        if ([401, 403, 404].includes(res.status)) return null;
        if (!res.ok) throw new Error("Failed to fetch book");
        const data = await res.json();
        try { await store.setItem(`book_${id}`, data) }
        catch (error) { if (error instanceof AccountChangedError) throw error }
        return data;
      } catch (error) {
        const cached = await store.getItem(`book_${id}`);
        if (cached) return cached as any;
        return null;
      }
    },
    enabled: !!id && !isNaN(id),
  });
}

export function useCreateBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: BookInput) => {
      const validated = api.books.create.input.parse(data);
      const res = await fetch(api.books.create.path, {
        method: api.books.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to create book");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.books.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/books/mine"] });
    },
  });
}

export function useUpdateBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & BookUpdateInput) => {
      const validated = api.books.update.input.parse(updates);
      const url = buildUrl(api.books.update.path, { id });
      const res = await fetch(url, {
        method: api.books.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({})) as { message?: string; currentRevision?: number }
        if (res.status === 409 && Number.isInteger(error.currentRevision)) {
          throw new BookConflictError(
            error.message || "El manuscrito cambió en otra sesión",
            Number(error.currentRevision),
          )
        }
        throw new Error(error.message || "Failed to update book");
      }

      const updatedBook = await res.json();
      // Update local cache
      try { await store.setItem(`book_${id}`, updatedBook) }
      catch (error) { if (error instanceof AccountChangedError) throw error }
      return updatedBook;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.books.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.books.get.path, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/books/mine"] });
    },
  });
}

export function useDeleteBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.books.delete.path, { id });
      const res = await fetch(url, { 
        method: api.books.delete.method,
        credentials: "include" 
      });

      if (!res.ok) throw new Error("Failed to delete book");
      // Remove from offline cache
      try { await store.removeItem(`book_${id}`) }
      catch (error) { if (error instanceof AccountChangedError) throw error }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.books.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/books/mine"] });
    },
  });
}
