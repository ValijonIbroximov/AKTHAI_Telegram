// Fayl: client/src/stores/theme.ts
// Maqsad: Yorug'/qorong'i mavzu tanlovi saqlanadi va saqlanib qoladi.
import { create } from "zustand";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: (localStorage.getItem("theme") as Theme) || "light",

  // Mavzu yorug'dan qorong'iga va aksincha almashtiriladi
  toggle: () =>
    set((s) => {
      const next: Theme = s.theme === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      return { theme: next };
    }),

  // Mavzu aniq qiymatga o'rnatiladi
  set: (t) => {
    localStorage.setItem("theme", t);
    set({ theme: t });
  },
}));
