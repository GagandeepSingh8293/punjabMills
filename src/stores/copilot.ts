import { create } from "zustand";
import { nanoid } from "nanoid";
import type { CopilotMessage } from "@/types/copilot";
import { copilotAnswer } from "@/lib/copilot";
import { useChallanStore } from "@/stores/challan";
import { useBillingStore } from "@/stores/billing";

interface CopilotState {
  messages: CopilotMessage[];
  input: string;
  sending: boolean;
  setInput: (v: string) => void;
  send: (text?: string) => Promise<void>;
  clear: () => void;
}

function assistant(status: CopilotMessage["status"], content: string, pendingId?: string): CopilotMessage {
  return { id: pendingId ?? nanoid(8), role: "assistant", content, status };
}

const GREETING = assistant(
  "done",
  "Hi! I'm your DyeAI assistant. Ask me about pending billing, challan statuses, invoice totals, or vehicle movements — I'll answer from your local data."
);

export const useCopilotStore = create<CopilotState>((set, get) => ({
  messages: [GREETING],
  input: "",
  sending: false,

  setInput: (input) => set({ input }),

  send: async (text) => {
    const question = (text ?? get().input).trim();
    if (!question || get().sending) return;

    const userMsg: CopilotMessage = { id: nanoid(8), role: "user", content: question, status: "done" };
    const pending = assistant("pending", "");
    set((s) => ({ messages: [...s.messages, userMsg, pending], input: "", sending: true }));

    const challans = useChallanStore.getState().items;
    const invoices = useBillingStore.getState().items;
    const answer = copilotAnswer(question, { challans, invoices });

    setTimeout(() => {
      set((s) => ({
        sending: false,
        messages: s.messages.map((m) => (m.id === pending.id ? { ...assistant("done", answer, m.id) } : m)),
      }));
    }, 450);
  },

  clear: () => set({ messages: [GREETING], input: "" }),
}));