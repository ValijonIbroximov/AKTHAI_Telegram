// Autentifikatsiya holati: token, joriy foydalanuvchi, session boshqaruvi.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { authApi, userApi } from "@/api/http";
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
      const res = await authApi.login(username, password);
      const me  = await userApi.me(res.access_token);

      // Tokenni Tauri xavfsiz xotiraga (SecureStorage) saqlash
      await invoke("store_token", { token: res.access_token });

      // Signal Protocol kalitlari bazasi mavjud bo'lmasa, yangi yaratilib yuklanadi
      await invoke("init_signal_keys", {
        token:  res.access_token,
        userId: me.id,
      });

      set({
        token:    res.access_token,
        userId:   me.id,
        username: me.username,
        role:     me.role as "admin" | "user",
        loading:  false,
      });

      wsClient.connect(res.access_token);
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
