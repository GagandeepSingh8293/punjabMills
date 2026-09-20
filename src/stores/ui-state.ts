import { create } from "zustand";
import type { ChallanRecord } from "@/types/challan";
import type { ColourRecord, Customer, DepthRecord, HsnCodeRecord, MasterRecord, ProcessorRecord, RateCardRecord } from "@/types/masters";

interface UiStateState {
  customers: Customer[];
  rateCards: RateCardRecord[];
  colours: ColourRecord[];
  depths: DepthRecord[];
  processors: ProcessorRecord[];
  hsnCodes: HsnCodeRecord[];
  pendingIncoming: ChallanRecord[];
  setCustomers: (records: MasterRecord[]) => void;
  setRateCards: (records: MasterRecord[]) => void;
  setColours: (records: MasterRecord[]) => void;
  setDepths: (records: MasterRecord[]) => void;
  setProcessors: (records: MasterRecord[]) => void;
  setHsnCodes: (records: MasterRecord[]) => void;
  setPendingIncoming: (records: ChallanRecord[]) => void;
}

export const useStateStore = create<UiStateState>((set) => ({
  customers: [],
  rateCards: [],
  colours: [],
  depths: [],
  processors: [],
  hsnCodes: [],
  pendingIncoming: [],
  setCustomers: (records) => set({ customers: records as Customer[] }),
  setRateCards: (records) => set({ rateCards: records as RateCardRecord[] }),
  setColours: (records) => set({ colours: records as ColourRecord[] }),
  setDepths: (records) => set({ depths: records as DepthRecord[] }),
  setProcessors: (records) => set({ processors: records as ProcessorRecord[] }),
  setHsnCodes: (records) => set({ hsnCodes: records as HsnCodeRecord[] }),
  setPendingIncoming: (pendingIncoming) => set({ pendingIncoming }),
}));