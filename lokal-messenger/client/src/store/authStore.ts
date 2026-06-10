// Multi-account autentifikatsiya — Telegram Desktop uslubida bir nechta sessiya.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  clearToken,
  activateCryptoContext,
  isTauri,
} from "@/crypto/adapter";
import { authApi, userApi, profileApi } from "@/api/http";
import { wsClient } from "@/api/ws";

// ── Nuke: barcha lokal shifrlash ma'lumotlarini o'chirish ─────────────────────
// Logout yoki hard reset paytida ishga tushadi.
// Brauzer: harbiy-signal-* IndexedDB bazalarini o'chiradi.
// Tauri:   signal_*.db fayllarini o'chiradi (nuke_local_data buyrug'i orqali).
async function nukeAllLocalData(): Promise<void> {
  // 1) IndexedDB (brauzer + Tauri WebView)
  try {
    if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs
          .filter((db) => db.name?.startsWith("harbiy-signal"))
          .map(
            (db) =>
              new Promise<void>((res) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess  = () => res();
                req.onerror    = () => res();
                req.onblocked  = () => res();
              })
          )
      );
      console.log("[Nuke] ✅ IndexedDB tozalandi");
    }
  } catch (e) {
    console.warn("[Nuke] IDB xatoligi:", e);
  }

  // 2) Tauri SQLite signal_*.db fayllarini o'chirish
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("nuke_local_data");
      console.log("[Nuke] ✅ Tauri SQLite tozalandi");
    } catch (e) {
      console.warn("[Nuke] Tauri SQLite xatoligi:", e);
    }
  }
}

export interface AccountSession {
  userId:               string;
  username:             string;
  displayName?:         string;
  role:                 "admin" | "user";
  token:                string;
  mustChangePassword:   boolean;
  hasAvatar?:           boolean;
  /** Tez qulf ochish uchun 4–6 raqamli PIN (SHA-256 hex) */
  pinHash?:             string;
}

export type AuthUIMode = "login" | "add_account" | "switch_unlock";

interface AuthState {
  accounts:          AccountSession[];
  activeAccountId:   string | null;
  /** Joriy akkaunt (komponentlar uchun qulaylik) */
  token:             string | null;
  userId:            string | null;
  username:          string | null;
  role:              "admin" | "user" | null;
  mustChangePassword: boolean;
  loading:           boolean;
  error:             string | null;
  uiMode:            AuthUIMode;
  canCreateChannel:  boolean;
  canCreateGroup:    boolean;
  /** switch_unlock rejimida qaysi akkauntga o'tilmoqchi */
  unlockTargetId:    string | null;

  login:              (username: string, password: string) => Promise<void>;
  addAccount:         (username: string, password: string) => Promise<void>;
  beginSwitchAccount: (userId: string) => void;
  beginAddAccount:    () => void;
  cancelAuthUI:       () => void;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithPin:      (pin: string) => Promise<boolean>;
  setAccountPin:      (pin: string) => Promise<void>;
  switchAccountDirect:(userId: string) => Promise<void>;
  logout:             () => Promise<void>;
  logoutAccount:      (userId: string) => Promise<void>;
  handleForceLogout:  (reason?: string, targetUserId?: string) => Promise<void>;
  validateAccounts:   () => Promise<void>;
  syncActiveProfile:  () => Promise<void>;
  changePassword:     (oldPwd: string, newPwd: string) => Promise<void>;
  dismissMustChangePassword: () => Promise<void>;
  clearError:         () => void;
  bootstrap:          () => Promise<void>;
}

async function activateSession(
  account: AccountSession,
  set: (p: Partial<AuthState>) => void,
): Promise<void> {
  console.log(`[Auth] 🔄 Account switch → ${account.username} (${account.userId})`);
  set({ loading: true, error: null });

  try {
    const me = await userApi.me(account.token);

    await wsClient.disconnectAsync();
    await activateCryptoContext(account.userId, account.token);

    set({
      activeAccountId:    account.userId,
      token:              account.token,
      userId:             account.userId,
      username:           account.username,
      role:               account.role,
      mustChangePassword: account.mustChangePassword,
      canCreateChannel:   me.can_create_channel !== false,
      canCreateGroup:     me.can_create_group !== false,
      uiMode:             "login",
      unlockTargetId:     null,
      error:              null,
    });

    const { useChatStore } = await import("@/store/chatStore");
    useChatStore.getState().onAccountSwitch(account.userId);

    await wsClient.connectAsync(account.token);
    void useChatStore.getState().loadChats(account.token);
    console.log(`[Auth] ✅ Active: ${account.username}, WS=${wsClient.isConnected()}`);
  } catch (e) {
    console.error("[Auth] activateSession xatoligi:", e);
    throw e;
  } finally {
    set({ loading: false });
  }
}

async function validateStoredAccounts(
  get: () => AuthState,
  set: (p: Partial<AuthState>) => void,
): Promise<void> {
  const { accounts, activeAccountId } = get();
  if (accounts.length === 0) return;

  const valid: AccountSession[] = [];
  for (const acc of accounts) {
    try {
      await userApi.me(acc.token);
      valid.push(acc);
    } catch {
      /* bloklangan yoki sessiya tugagan */
    }
  }

  if (valid.length === accounts.length) return;

  const removedActive = Boolean(
    activeAccountId && !valid.some((a) => a.userId === activeAccountId),
  );
  const msg = "Hisobingiz administrator tomonidan bloklandi yoki sessiya tugadi";

  if (removedActive) {
    await wsClient.disconnectAsync();
  }

  if (valid.length === 0) {
    const { useChatStore } = await import("@/store/chatStore");
    useChatStore.getState().onAccountSwitch("");
    set({
      accounts:           [],
      activeAccountId:    null,
      token:              null,
      userId:             null,
      username:           null,
      role:               null,
      mustChangePassword: false,
      uiMode:             "login",
      error:              msg,
    });
    return;
  }

  set({ accounts: valid });

  if (removedActive) {
    set({ error: msg });
    await activateSession(valid[0]!, set);
  }
}

async function hashPin(pin: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${pin}`);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function upsertAccount(accounts: AccountSession[], next: AccountSession): AccountSession[] {
  const idx = accounts.findIndex((a) => a.userId === next.userId);
  if (idx >= 0) {
    const copy = [...accounts];
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [...accounts, next];
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accounts:           [],
      activeAccountId:    null,
      token:              null,
      userId:             null,
      username:           null,
      role:               null,
      mustChangePassword: false,
      loading:            false,
      error:              null,
      uiMode:             "login",
      unlockTargetId:     null,
      canCreateChannel:   true,
      canCreateGroup:     true,

      login: async (username, password) => {
        set({ loading: true, error: null });
        try {
          const res = await authApi.login(username, password);
          const account: AccountSession = {
            userId:             res.user_id,
            username,
            role:               res.role as "admin" | "user",
            token:              res.token,
            mustChangePassword: res.must_change_password,
          };
          const accounts = upsertAccount(get().accounts, account);
          set({ accounts, loading: false });
          await activateSession(account, set);
          await get().syncActiveProfile();
        } catch (err) {
          set({
            loading: false,
            error:   err instanceof Error ? err.message : "Kirish xatoligi",
          });
        }
      },

      addAccount: async (username, password) => {
        set({ loading: true, error: null });
        try {
          const res = await authApi.login(username, password);
          const account: AccountSession = {
            userId:             res.user_id,
            username,
            role:               res.role as "admin" | "user",
            token:              res.token,
            mustChangePassword: res.must_change_password,
          };
          const accounts = upsertAccount(get().accounts, account);
          set({ accounts, loading: false });
          await activateSession(account, set);
          await get().syncActiveProfile();
        } catch (err) {
          set({
            loading: false,
            error:   err instanceof Error ? err.message : "Akkaunt qo'shish xatoligi",
          });
        }
      },

      beginSwitchAccount: (userId) => {
        if (userId === get().activeAccountId) return;
        const target = get().accounts.find((a) => a.userId === userId);
        if (!target) return;
        if (target.pinHash) {
          set({ uiMode: "switch_unlock", unlockTargetId: userId, error: null });
          return;
        }
        void activateSession(target, set);
      },

      beginAddAccount: () => {
        set({ uiMode: "add_account", error: null });
      },

      cancelAuthUI: () => {
        const { accounts, activeAccountId } = get();
        if (accounts.length === 0 || !activeAccountId) {
          set({ uiMode: "login", unlockTargetId: null, error: null });
          return;
        }
        set({ uiMode: "login", unlockTargetId: null, error: null });
      },

      unlockWithPassword: async (password) => {
        const targetId = get().unlockTargetId;
        if (!targetId) return;
        const target = get().accounts.find((a) => a.userId === targetId);
        if (!target) return;
        set({ loading: true, error: null });
        try {
          const res = await authApi.login(target.username, password);
          const updated: AccountSession = {
            ...target,
            token:              res.token,
            mustChangePassword: res.must_change_password,
          };
          const accounts = upsertAccount(get().accounts, updated);
          set({ accounts, loading: false });
          await activateSession(updated, set);
        } catch (err) {
          set({
            loading: false,
            error:   err instanceof Error ? err.message : "Parol noto'g'ri",
          });
        }
      },

      unlockWithPin: async (pin) => {
        const targetId = get().unlockTargetId;
        if (!targetId || !/^\d{4,6}$/.test(pin)) return false;
        const target = get().accounts.find((a) => a.userId === targetId);
        if (!target?.pinHash) return false;
        const h = await hashPin(pin, targetId);
        if (h !== target.pinHash) {
          set({ error: "PIN noto'g'ri" });
          return false;
        }
        set({ loading: true, error: null });
        try {
          await activateSession(target, set);
          set({ loading: false });
          return true;
        } catch {
          set({ loading: false, error: "Akkauntga o'tib bo'lmadi" });
          return false;
        }
      },

      setAccountPin: async (pin) => {
        const uid = get().activeAccountId;
        if (!uid || !/^\d{4,6}$/.test(pin)) {
          throw new Error("PIN 4–6 ta raqamdan iborat bo'lishi kerak");
        }
        const pinHash = await hashPin(pin, uid);
        const accounts = get().accounts.map((a) =>
          a.userId === uid ? { ...a, pinHash } : a
        );
        set({ accounts });
      },

      switchAccountDirect: async (userId) => {
        const target = get().accounts.find((a) => a.userId === userId);
        if (!target) return;
        if (target.userId === get().activeAccountId) return;
        if (target.pinHash) {
          set({ uiMode: "switch_unlock", unlockTargetId: userId, error: null });
          return;
        }
        await activateSession(target, set);
      },

      bootstrap: async () => {
        await validateStoredAccounts(get, set);
        const account =
          get().accounts.find((a) => a.userId === get().activeAccountId) ??
          get().accounts[0] ??
          null;
        if (!account) return;
        try {
          await activateSession(account, set);
          await get().syncActiveProfile();
        } catch (e) {
          console.warn("[Bootstrap] xatolik:", e);
        }
      },

      validateAccounts: async () => {
        await validateStoredAccounts(get, set);
      },

      syncActiveProfile: async () => {
        const { token, activeAccountId } = get();
        if (!token || !activeAccountId) return;
        try {
          const profile = await profileApi.get(token);
          set({
            accounts: get().accounts.map((a) =>
              a.userId === activeAccountId
                ? {
                    ...a,
                    displayName: profile.display_name,
                    hasAvatar:   profile.has_avatar,
                    username:    profile.username,
                  }
                : a,
            ),
            username: profile.username,
          });
        } catch {
          /* ignore */
        }
      },

      logout: async () => {
        // Hard reset: barcha akkauntlarni tozalab, lokal shifrlash ma'lumotlarini o'chiradi.
        const { accounts } = get();

        // 1) WebSocket ulanishini yopish
        await wsClient.disconnectAsync();

        // 2) Barcha akkauntlar uchun serverda logout (xatolik bo'lsa ham davom etamiz)
        for (const acc of accounts) {
          await authApi.logout(acc.token).catch(() => {});
        }
        await clearToken();

        // 3) Lokal shifrlash ma'lumotlarini batamom o'chirish
        //    (IndexedDB harbiy-signal-* va Tauri signal_*.db)
        await nukeAllLocalData();

        // 4) Auth store persist-ni localStorage dan tozalash
        try { localStorage.removeItem("harbiy-auth-v2"); } catch { /* */ }

        // 5) Zustand state ni reset qilish
        set({
          accounts:           [],
          activeAccountId:    null,
          token:              null,
          userId:             null,
          username:           null,
          role:               null,
          mustChangePassword: false,
          uiMode:             "login",
        });

        console.log("[Auth] ✅ Hard logout: barcha ma'lumotlar o'chirildi");
      },

      logoutAccount: async (userId) => {
        const { accounts, activeAccountId } = get();
        const target = accounts.find((a) => a.userId === userId);
        if (!target) return;

        if (target.token && userId === activeAccountId) {
          await wsClient.disconnectAsync();
          await authApi.logout(target.token).catch(() => {});
          await clearToken();
        } else if (target.token) {
          await authApi.logout(target.token).catch(() => {});
        }

        const remaining = accounts.filter((a) => a.userId !== userId);

        if (userId === activeAccountId) {
          if (remaining.length > 0) {
            set({ accounts: remaining });
            await activateSession(remaining[0]!, set);
            return;
          }
          const { useChatStore } = await import("@/store/chatStore");
          useChatStore.getState().onAccountSwitch("");
          set({
            accounts:           [],
            activeAccountId:    null,
            token:              null,
            userId:             null,
            username:           null,
            role:               null,
            mustChangePassword: false,
            uiMode:             "login",
          });
          return;
        }

        set({ accounts: remaining });
      },

      handleForceLogout: async (reason, targetUserId) => {
        const uid = targetUserId ?? get().activeAccountId;
        if (!uid) return;

        const { activeAccountId, accounts } = get();
        const isActive = uid === activeAccountId;

        const msg =
          reason === "deleted"
            ? "Hisobingiz administrator tomonidan o'chirildi"
            : "Hisobingiz administrator tomonidan bloklandi";

        if (isActive) {
          await wsClient.disconnectAsync();
          await clearToken().catch(() => {});
        }

        const remaining = accounts.filter((a) => a.userId !== uid);

        if (isActive) {
          if (remaining.length > 0) {
            set({ accounts: remaining, error: msg });
            await activateSession(remaining[0]!, set);
            return;
          }
          const { useChatStore } = await import("@/store/chatStore");
          useChatStore.getState().onAccountSwitch("");
          set({
            accounts:           [],
            activeAccountId:    null,
            token:              null,
            userId:             null,
            username:           null,
            role:               null,
            mustChangePassword: false,
            uiMode:             "login",
            error:              msg,
          });
          return;
        }

        set({ accounts: remaining });
      },

      changePassword: async (oldPwd, newPwd) => {
        const { token } = get();
        if (!token) throw new Error("Sessiya yo'q");
        await authApi.changePassword(token, oldPwd, newPwd);
        set({
          mustChangePassword: false,
          accounts: get().accounts.map((a) =>
            a.userId === get().activeAccountId
              ? { ...a, mustChangePassword: false }
              : a
          ),
        });
      },

      dismissMustChangePassword: async () => {
        const { token } = get();
        if (!token) return;
        await authApi.dismissPasswordChange(token);
        set({
          mustChangePassword: false,
          accounts: get().accounts.map((a) =>
            a.userId === get().activeAccountId
              ? { ...a, mustChangePassword: false }
              : a
          ),
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name:    "harbiy-auth-v2",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persisted) => {
        const p = persisted as Record<string, unknown> | undefined;
        if (!p) return { accounts: [], activeAccountId: null };
        if (Array.isArray(p.accounts)) return persisted;
        if (p.token && p.userId) {
          return {
            accounts: [{
              userId:             p.userId,
              username:           p.username ?? "",
              role:               p.role ?? "user",
              token:              p.token,
              mustChangePassword: false,
            }],
            activeAccountId: p.userId,
          };
        }
        return { accounts: [], activeAccountId: null };
      },
      partialize: (s) => ({
        accounts:        s.accounts,
        activeAccountId: s.activeAccountId,
      }),
    }
  )
);

/** Joriy akkaunt */
export function selectActiveAccount(state: AuthState): AccountSession | null {
  if (!state.activeAccountId) return null;
  return state.accounts.find((a) => a.userId === state.activeAccountId) ?? null;
}

wsClient.on((event) => {
  if (event.type === "auth.force_logout") {
    const payload = event.payload as { reason?: string; user_id?: string };
    void useAuthStore.getState().handleForceLogout(payload.reason, payload.user_id);
  }
});
