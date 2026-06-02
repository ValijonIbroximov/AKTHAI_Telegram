// Autentifikatsiya holati: token, joriy foydalanuvchi, session boshqaruvi.
// persist middleware: token localStorage ga saqlanadi — refresh keyin ham sessiya saqlanadi.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storeToken, clearToken, initSignalKeys } from "@/crypto/adapter";
import { authApi } from "@/api/http";
import { wsClient } from "@/api/ws";

interface AuthState {
  token:    string | null;
  userId:   string | null;
  username: string | null;
  role:     "admin" | "user" | null;
  loading:  boolean;
  error:    string | null;

  login:       (username: string, password: string) => Promise<void>;
  logout:      () => Promise<void>;
  clearError:  () => void;
  /** Ilova yuklanganda chaqiriladi: token mavjud bo'lsa WS qayta ulanadi */
  bootstrap:   () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
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
          const jwt = res.token;

          await storeToken(jwt);
          await initSignalKeys(jwt, res.user_id);

          set({
            token:    jwt,
            userId:   res.user_id,
            username,
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

      // Sahifa yuklanishida chaqiriladi — localStorage dan token o'qilsa WS qayta ulanadi
      bootstrap: async () => {
        const { token, userId } = get();
        if (!token) return;
        try {
          await storeToken(token);  // Tauri/browser xotiraga ham nusxa ko'chiradi
          wsClient.connect(token);
          // Kalitlarni serverga qayta yuklash (server DB reset bo'lsa ham kafolatlanadi)
          await initSignalKeys(token, userId ?? "").catch((e) =>
            console.warn("[Bootstrap] initSignalKeys:", e)
          );
        } catch (e) {
          console.warn("[Bootstrap] xatolik:", e);
        }
      },

      logout: async () => {
        const { token } = get();
        wsClient.disconnect();
        if (token) {
          await authApi.logout(token).catch(() => {});
          await clearToken();
        }
        set({ token: null, userId: null, username: null, role: null });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name:    "harbiy-auth",                          // localStorage kalit nomi
      storage: createJSONStorage(() => localStorage),
      // Faqat autentifikatsiya ma'lumotlari saqlanadi — loading/error emas
      partialize: (s) => ({
        token:    s.token,
        userId:   s.userId,
        username: s.username,
        role:     s.role,
      }),
    }
  )
);
