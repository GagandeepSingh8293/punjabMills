import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { CommandDialog } from "@/components/layout/CommandDialog";
import { CopilotPanel } from "@/components/layout/CopilotPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSidebarStore } from "@/stores/sidebar";

export function AppShell() {
  const { mobileOpen, setMobileOpen, copilotOpen } = useSidebarStore();
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

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
      {copilotOpen && <CopilotPanel />}
      <CommandDialog />
    </TooltipProvider>
  );
}