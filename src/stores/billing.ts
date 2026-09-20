import { create } from "zustand";
import type { Invoice, InvoiceListResponse } from "@/types/billing";
import { api } from "@/lib/api";

interface BillingState {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  loading: boolean;
  error: string | null;
  setQuery: (q: string) => void;
  setStatus: (status: string) => void;
  setPage: (page: number) => void;
  fetch: () => Promise<InvoiceListResponse>;
  upsert: (invoice: Invoice) => void;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  q: "",
  status: "",
  loading: false,
  error: null,

  setQuery: (q) => set({ q, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setPage: (page) => set({ page }),

  fetch: async () => {
    set({ loading: true, error: null });
    const { q, status, page, pageSize } = get();
    try {
      const res = await api.invoices.list({ q: q || undefined, status: status || undefined, page, pageSize });
      set({ items: res.items, total: res.total, page: res.page, pageSize: res.pageSize, loading: false });
      return res;
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  upsert: (invoice) =>
    set((state) => {
      const exists = state.items.some((i) => i.id === invoice.id);
      return {
        items: exists
          ? state.items.map((i) => (i.id === invoice.id ? invoice : i))
          : [invoice, ...state.items],
      };
    }),
}));