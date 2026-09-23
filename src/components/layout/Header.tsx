import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Search, Menu, LogOut, Settings, User as UserIcon, Moon, Sun, Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useUserStore } from "@/stores/user";
import { useSidebarStore } from "@/stores/sidebar";
import { useSearchStore } from "@/stores/search";
import { useThemeStore } from "@/stores/theme";
import { useCloudSyncStore } from "@/stores/cloud-sync";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { user, logout } = useUserStore();
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen);
  const setSearchOpen = useSearchStore((s) => s.setOpen);
  const resolved = useThemeStore((s) => s.resolved);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const navigate = useNavigate();
  const cloud = useCloudSyncStore();

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void useCloudSyncStore.getState().bind().then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, []);

  if (!user) return null;

  const pendingTotal =
    (cloud.status?.pending?.challans ?? 0) +
    Object.values(cloud.status?.pending?.masters ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur">
      <button
        onClick={() => setMobileOpen(true)}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button
        onClick={() => setSearchOpen(true)}
        className="flex h-9 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:max-w-sm"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search challans, customers…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => {
            if (!cloud.status?.configured) {
              navigate("/sync");
              return;
            }
            void useCloudSyncStore.getState().syncNow();
          }}
          className={`inline-flex h-9 max-w-56 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-accent ${
            cloud.status?.configured
              ? cloud.status.online
                ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
                : "border-amber-600/40 text-amber-700 dark:text-amber-400"
              : "border-border text-muted-foreground"
          }`}
          title={
            cloud.status?.configured
              ? `Cloud sync · last ${cloud.status.lastSyncedAt || "never"}${pendingTotal ? ` · ${pendingTotal} pending` : ""}`
              : "Cloud sync not configured — open Sync page to set it up"
          }
        >
          {cloud.status?.configured ? (
            cloud.status.syncing ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : cloud.status.online ? (
              <Cloud className="h-3.5 w-3.5" />
            ) : (
              <CloudOff className="h-3.5 w-3.5" />
            )
          ) : (
            <CloudOff className="h-3.5 w-3.5" />
          )}
          {cloud.status?.configured && (
            <span className="hidden min-w-0 truncate sm:block">
              {cloud.status.syncing
                ? "Syncing…"
                : cloud.status.online
                  ? `Online · ${cloud.status.lastSyncedAt?.slice(11, 16) ?? "—"}${pendingTotal ? ` · ${pendingTotal}↑` : ""}`
                  : "Offline"}
            </span>
          )}
        </button>

        <button
          onClick={toggleTheme}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent" aria-label="Account menu">
              <Avatar name={user.name} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/profile")}>
              <UserIcon />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/profile")}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="text-destructive"
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}