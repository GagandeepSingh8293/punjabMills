import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

const KEY = "dyeai-theme";

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(("prefers-color-scheme: dark") as string)?.matches;
}

export function resolveTheme(theme: Theme | null): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return prefersDark() ? "dark" : "light";
}

export function applyTheme(theme: Theme | null) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

function readInitial(): Theme {
  const stored = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) as Theme | null;
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

const initial = readInitial();
applyTheme(initial);

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial,
  resolved: resolveTheme(initial),
  setTheme: (theme) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, theme);
    applyTheme(theme);
    set({ theme, resolved: resolveTheme(theme) });
  },
  toggle: () => {
    get().setTheme(get().resolved === "dark" ? "light" : "dark");
  },
}));

if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { theme } = useThemeStore.getState();
    if (theme === "system") {
      applyTheme(theme);
      useThemeStore.setState({ resolved: resolveTheme(theme) });
    }
  });
}