import { Database, Inbox, LayoutDashboard, Receipt, Truck, type LucideIcon } from "lucide-react";
import { canAccessModule, type Module } from "@/lib/permissions";
import type { Role } from "@/types/user";

export interface NavItem {
  module: Module;
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ module: "home", label: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    id: "challans",
    label: "Challans",
    items: [
      { module: "challans", label: "Incoming Challans", href: "/challans", icon: Inbox },
      { module: "challans", label: "Outgoing Challans", href: "/challans/outgoing", icon: Truck },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [{ module: "billing", label: "Billing", href: "/billing", icon: Receipt }],
  },
  {
    id: "masters",
    label: "Master Data",
    items: [{ module: "masters", label: "Master Data", href: "/masters", icon: Database }],
  },
];

export function navSectionsForRole(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessModule(role, item.module)),
  })).filter((section) => section.items.length > 0);
}

export function isNavItemActive(pathname: string, href: string, allHrefs: string[] = []): boolean {
  if (href === "/") return pathname === "/";
  if (pathname !== href && !pathname.startsWith(`${href}/`)) return false;

  const longestMatch = allHrefs
    .filter((h) => h === pathname || pathname.startsWith(`${h}/`))
    .reduce((longest, h) => (h.length > longest.length ? h : longest), href);
  return longestMatch === href;
}