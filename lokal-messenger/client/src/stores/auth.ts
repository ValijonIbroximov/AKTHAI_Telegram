// Fayl: client/src/stores/auth.ts
// Maqsad: Foydalanuvchi sessiyasi mahalliy disk va xotirada saqlanadi.
import { create } from "zustand";

interface SessionData {
  token: string;
  userId: string;
  role: string;
  mustChange: boolean;
}

interface AuthState {
  token: string | null;
  userId: string | null;
  role: string | null;
  mustChange: boolean;
  setSession: (s: SessionData) => void;
  clear: () => void;
  hydrate: () => void;
}

const STORAGE_KEY = "auth_session_v1";

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  role: null,
  mustChange: false,

  // Sessiya o'rnatiladi va mahalliy saqlovga yoziladi
  setSession: (s) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    set({
      token: s.token,
      userId: s.userId,
      role: s.role,
      mustChange: s.mustChange,
    });
  },

  // Sessiya tozalanadi (chiqishda)
  clear: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, userId: null, role: null, mustChange: false });
  },

  // Saqlangan sessiya xotiraga yuklanadi (mavjud bo'lsa)
  hydrate: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const s: SessionData = JSON.parse(raw);
        set({
          token: s.token,
          userId: s.userId,
          role: s.role,
          mustChange: s.mustChange,
        });
      } catch {
        // Buzilgan saqlov e'tiborsiz qoldiriladi
      }
    }
  },
}));
