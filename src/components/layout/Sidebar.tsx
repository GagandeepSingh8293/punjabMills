import { NavLink } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { navSectionsForRole, isNavItemActive } from "@/lib/nav-config";
import { useSidebarStore } from "@/stores/sidebar";
import { useUserStore } from "@/stores/user";
import { useLocation } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function Sidebar() {
  const { user } = useUserStore();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const mobileOpen = useSidebarStore((s) => s.mobileOpen);
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen);
  const { pathname } = useLocation();

  if (!user) return null;
  const sections = navSectionsForRole(user.role);
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));

  return (
    <aside
      className={cn(
        "top-0 z-40 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200",
        "sticky max-lg:fixed max-lg:h-full",
        collapsed && "w-16",
        !mobileOpen && "max-lg:translate-x-[-100%]",
        mobileOpen && "max-lg:translate-x-0 max-lg:shadow-2xl"
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-4", collapsed && "justify-center px-2")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
          <Package className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-primary-foreground">DyeAI</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-sidebar-muted-foreground">Job Work Suite</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {sections.map((section) => (
          <div key={section.id}>
            {!collapsed && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(pathname, item.href, allHrefs);
                const link = (
                  <NavLink
                    to={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                );
                return collapsed ? (
                  <li key={item.href}>
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  </li>
                ) : (
                  <li key={item.href}>{link}</li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={toggleCollapsed}
          className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 max-lg:hidden"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}