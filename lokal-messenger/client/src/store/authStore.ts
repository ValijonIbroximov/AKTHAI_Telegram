// Autentifikatsiya holati: token, joriy foydalanuvchi, session boshqaruvi.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { authApi } from "@/api/http";
import { wsClient } from "@/api/ws";

interface AuthState {
  token:    string | null;
  userId:   string | null;
  username: string | null;
  role:     "admin" | "user" | null;
  loading:  boolean;
  error:    string | null;

  login:    (username: string, password: string) => Promise<void>;
  logout:   () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token:    null,
  userId:   null,
  username: null,
  role:     null,
  loading:  false,
  error:    null,

  // Kirish: server login → token saqlanadi → WS ulanadi → Signal kalitlari yuklanadi
  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      // Login response'da user_id, role va token mavjud — alohida /me chaqiruvi shart emas
      const res = await authApi.login(username, password);
      const jwt = res.token;

      // Tokenni Tauri xavfsiz xotiraga saqlash
      await invoke("store_token", { token: jwt });

      // Signal Protocol kalitlari bazasi mavjud bo'lmasa, yangi yaratilib yuklanadi
      await invoke("init_signal_keys", {
        token:  jwt,
        userId: res.user_id,
      });

      set({
        token:    jwt,
        userId:   res.user_id,
        username,              // foydalanuvchi kiritgan login ishlatiladi
        role:     res.role as "admin" | "user",
        loading:  false,
      });

      wsClient.connect(jwt);
    } catch (err) {
      set({
        loading: false,
        error:   err instanceof Error ? err.message : "Kirish xatoligi",
      });
    }
  },

  logout: async () => {
    const { token } = get();
    wsClient.disconnect();
    if (token) {
      await authApi.logout(token).catch(() => {});
      await invoke("clear_token");
    }
    set({ token: null, userId: null, username: null, role: null });
  },

  clearError: () => set({ error: null }),
}));
