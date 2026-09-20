import type { Role } from "@/types/user";

export const MODULES = ["home", "challans", "billing", "masters", "sync", "profile"] as const;
export type Module = (typeof MODULES)[number];

export const ROLE_MODULE_ACCESS: Record<Role, Module[]> = {
  Admin: ["home", "challans", "billing", "masters", "sync", "profile"],
  Supervisor: ["home", "challans", "billing", "masters", "sync", "profile"],
  Operator: ["home", "challans", "sync", "profile"],
  Accounts: ["home", "billing", "profile"],
};

const MODULE_HREF: Record<Module, string> = {
  home: "/",
  challans: "/challans",
  billing: "/billing",
  masters: "/masters",
  sync: "/sync",
  profile: "/profile",
};

export const MODULE_LABELS: Record<Module, string> = {
  home: "Dashboard",
  challans: "Challans",
  billing: "Billing",
  masters: "Master Data",
  sync: "Sync",
  profile: "Profile",
};

export const MODULE_DESCRIPTIONS: Record<Module, string> = {
  home: "View dashboard KPIs and summaries",
  challans: "Create and manage incoming & outgoing challans",
  billing: "Generate and manage invoices",
  masters: "Manage customers, processors, rates, depths, colours and HSN codes",
  sync: "Sync challans from a phone over the local network",
  profile: "View and edit your own account details",
};

export function moduleForPath(pathname: string): Module {
  if (pathname.startsWith("/challans")) return "challans";
  if (pathname.startsWith("/billing")) return "billing";
  if (pathname.startsWith("/masters")) return "masters";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/sync")) return "sync";
  return "home";
}

export function canAccessModule(role: Role, mod: Module): boolean {
  return ROLE_MODULE_ACCESS[role].includes(mod);
}

export function canAccessPath(role: Role, pathname: string): boolean {
  return canAccessModule(role, moduleForPath(pathname));
}

export function firstAccessibleHref(role: Role): string {
  const preferredOrder: Module[] = ["home", "challans", "billing", "masters", "sync", "profile"];
  const match = preferredOrder.find((mod) => canAccessModule(role, mod));
  return MODULE_HREF[match ?? "profile"];
}