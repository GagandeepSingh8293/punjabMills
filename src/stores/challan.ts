import { create } from "zustand";
import type { ChallanListResponse, ChallanRecord } from "@/types/challan";
import { api } from "@/lib/api";

export interface ChallanFilters {
  q?: string;
  documentType?: string;
  from?: string;
  to?: string;
  excludeBilled?: boolean;
  excludeInvoiceId?: string;
  pendingOnly?: boolean;
  challanNo?: string;
  lot?: string;
  vehicleNo?: string;
  customer?: string;
  destination?: string;
  weight?: string;
  hsn?: string;
  colour?: string;
  depth?: string;
  status?: string;
  date?: string;
  page?: number;
  pageSize?: number;
}

interface ChallanState {
  items: ChallanRecord[];
  total: number;
  page: number;
  pageSize: number;
  filters: ChallanFilters;
  loading: boolean;
  error: string | null;
  setFilters: (filters: Partial<ChallanFilters>) => void;
  fetch: (overrides?: Partial<ChallanFilters>) => Promise<ChallanListResponse>;
  refresh: () => Promise<void>;
  upsert: (challan: ChallanRecord) => void;
}

const DEFAULT_PAGE_SIZE = 8;

export const useChallanStore = create<ChallanState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  filters: {},
  loading: false,
  error: null,

  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters, page: filters.page ?? 1 },
      page: filters.page ?? 1,
    })),

  fetch: async (overrides = {}) => {
    set({ loading: true, error: null });
    const filters = { ...get().filters, ...overrides };
    try {
      const res = await api.challans.list(filters);
      set({
        items: res.items,
        total: res.total,
        page: res.page,
        pageSize: res.pageSize,
        filters,
        loading: false,
      });
      return res;
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  refresh: async () => {
    await get().fetch();
  },

  upsert: (challan) =>
    set((state) => {
      const exists = state.items.some((c) => c.id === challan.id);
      return {
        items: exists
          ? state.items.map((c) => (c.id === challan.id ? challan : c))
          : [challan, ...state.items],
      };
    }),
}));