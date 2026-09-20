import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { CommandDialog } from "@/components/layout/CommandDialog";
import { CopilotPanel } from "@/components/layout/CopilotPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSidebarStore } from "@/stores/sidebar";
import { useStateStore } from "@/stores/ui-state";
import { useChallanStore } from "@/stores/challan";
import { SYNC_EVENTS, type SyncedChallanPayload } from "@/types/socket-events";

export function AppShell() {
  const { mobileOpen, setMobileOpen, copilotOpen, setCopilotOpen } = useSidebarStore();
  const { pathname } = useLocation();
  const toast = useStateStore((s) => s.toast);
  const clearToast = useStateStore((s) => s.clearToast);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      try {
        unlisten = await listen(SYNC_EVENTS.CHALLAN_SYNCED, ({ payload }) => {
          const record = payload as SyncedChallanPayload;
          useStateStore.getState().pushToast(`Challan ${record.header.challanNo} synced from phone`);
          void useChallanStore.getState().fetch();
        });
      } catch {
        // Running in a plain browser (npm run dev) — no Tauri runtime.
      }
    })();
    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4000);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen">
        <Sidebar />
        {mobileOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      {toast && (
        <div className="fixed right-5 z-50 bottom-20 flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg animate-in slide-in-from-bottom-4 fade-in-0">
          <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          {toast}
        </div>
      )}
      <button
        onClick={() => setCopilotOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
        aria-label="Open Copilot"
        title="Copilot"
      >
        <Sparkles className="h-5 w-5" />
      </button>
      {copilotOpen && <CopilotPanel />}
      <CommandDialog />
    </TooltipProvider>
  );
}