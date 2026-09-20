import { create } from "zustand";
import type { User } from "@/types/user";
import { api } from "@/lib/api";

const SESSION_KEY = "dyeai_session_user_id";

interface UserState {
  user: User | null;
  loading: boolean;
  initializing: boolean;
  init: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<User | null>;
  setUser: (user: User) => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  loading: false,
  initializing: true,

  init: async () => {
    const storedId = localStorage.getItem(SESSION_KEY);
    if (!storedId) {
      set({ initializing: false });
      return;
    }
    try {
      const user = await api.auth.getUser(storedId);
      if (user) set({ user });
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // keep session marker; login screen will present itself
    } finally {
      set({ initializing: false });
    }
  },

  login: async (identifier, password) => {
    set({ loading: true });
    try {
      const user = await api.auth.login(identifier, password);
      localStorage.setItem(SESSION_KEY, user.id);
      set({ user, loading: false });
      return user;
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout: () => {
    localStorage.removeItem(SESSION_KEY);
    set({ user: null });
  },

  refresh: async () => {
    const u = get().user;
    if (!u) return null;
    const fresh = await api.auth.getUser(u.id);
    if (fresh) set({ user: fresh });
    return fresh;
  },

  setUser: (user) => set({ user }),
}));