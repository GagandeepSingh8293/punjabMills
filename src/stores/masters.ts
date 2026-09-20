import { create } from "zustand";
import type { MasterRecord, MasterType } from "@/types/masters";
import { api } from "@/lib/api";

interface MastersState {
  records: Partial<Record<MasterType, MasterRecord[]>>;
  activeType: MasterType;
  loading: Record<MasterType, boolean>;
  setActiveType: (type: MasterType) => void;
  fetch: (type: MasterType) => Promise<MasterRecord[]>;
  create: (type: MasterType, payload: Record<string, unknown>) => Promise<MasterRecord>;
  update: (type: MasterType, id: string, payload: Record<string, unknown>) => Promise<MasterRecord>;
}

export const useMastersStore = create<MastersState>((set, get) => ({
  records: {},
  activeType: "customers",
  loading: {} as Record<MasterType, boolean>,

  setActiveType: (type) => set({ activeType: type }),

  fetch: async (type) => {
    set((state) => ({ loading: { ...state.loading, [type]: true } }));
    try {
      const records = await api.masters.list(type);
      set((state) => ({ records: { ...state.records, [type]: records } }));
      return records;
    } finally {
      set((state) => ({ loading: { ...state.loading, [type]: false } }));
    }
  },

  create: async (type, payload) => {
    const record = await api.masters.create(type, payload);
    set((state) => ({
      records: { ...state.records, [type]: [...(state.records[type] ?? []), record] },
    }));
    return record;
  },

  update: async (type, id, payload) => {
    const record = await api.masters.update(type, id, payload);
    set((state) => ({
      records: {
        ...state.records,
        [type]: (state.records[type] ?? []).map((r) => (r.id === id ? record : r)),
      },
    }));
    return record;
  },
}));

export function useMastersRecords(type: MasterType): MasterRecord[] {
  return useMastersStore((s) => s.records[type] ?? []);
}