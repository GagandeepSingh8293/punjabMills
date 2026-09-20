import { create } from "zustand";
import type { GlobalSearchResponse } from "@/types/search";
import { api } from "@/lib/api";

const EMPTY: GlobalSearchResponse = { challans: { items: [], total: 0 }, customers: { items: [], total: 0 } };

interface SearchState {
  open: boolean;
  query: string;
  results: GlobalSearchResponse;
  loading: boolean;
  setOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  close: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  open: false,
  query: "",
  results: EMPTY,
  loading: false,
  setOpen: (open) => set({ open, query: "", results: EMPTY }),
  setQuery: async (q) => {
    set({ query: q, loading: true });
    if (!q.trim()) {
      set({ results: EMPTY, loading: false });
      return;
    }
    try {
      const results = await api.search.global(q);
      set({ results, loading: false });
    } catch {
      set({ results: EMPTY, loading: false });
    }
  },
  close: () => set({ open: false, query: "", results: EMPTY }),
}));