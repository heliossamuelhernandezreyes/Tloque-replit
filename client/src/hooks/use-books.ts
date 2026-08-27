import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type BookInput, type BookUpdateInput } from "@shared/routes";
import localforage from "localforage";

// Initialize offline storage
const store = localforage.createInstance({
  name: "Novareads",
  storeName: "books"
});

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
  return useQuery({
    queryKey: [api.books.list.path],
    queryFn: async () => {
      try {
        const res = await fetch(api.books.list.path, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch books");
        const data = await res.json();

        // Cache for offline
        await store.setItem("books_list", data);
        return data; // Trusting standard response without strict parse to avoid breakages on missing fields
      } catch (error) {
        console.warn("Network fetch failed, attempting offline cache for list...");
        const cached = await store.getItem("books_list");
        if (cached) return cached as any[];
        throw error;
      }
    },
  });
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
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Failed to fetch book");
        const data = await res.json();
        await store.setItem(`book_${id}`, data);
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
      await store.setItem(`book_${id}`, updatedBook);
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
      await store.removeItem(`book_${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.books.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/books/mine"] });
    },
  });
}
