import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import { CLOUD_SYNC_EVENTS, type CloudSyncStatus } from "@/types/socket-events";

type CloudSyncState = {
  status: CloudSyncStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  bind: () => Promise<() => void>;
};

export const useCloudSyncStore = create<CloudSyncState>((set) => ({
  status: null,
  error: null,

  refresh: async () => {
    try {
      const status = await api.cloud.status();
      set({ status, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  syncNow: async () => {
    set((s) => (s.status ? { status: { ...s.status, syncing: true } } : {}));
    try {
      const result = await api.cloud.syncNow();
      if (result.status) set({ status: result.status, error: result.error ?? null });
      else set({ error: result.error ?? "Sync failed" });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  bind: async () => {
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];
    try {
      const un = await listen(CLOUD_SYNC_EVENTS.STATUS, (e) => {
        if (!mounted) return;
        const payload = e.payload as CloudSyncStatus & { error?: string };
        set({ status: payload as CloudSyncStatus, error: payload.error ?? null });
      });
      unlisteners.push(un);
    } catch {
      // Running in a plain browser (npm run dev) — no Tauri runtime.
    }
    void useCloudSyncStore.getState().refresh();
    return () => {
      mounted = false;
      for (const un of unlisteners) void un();
    };
  },
}));