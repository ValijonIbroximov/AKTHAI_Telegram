// Server bilan HTTP/REST muloqot qiluvchi qatlam.
// Tauri WebView ichida ishlaydi — CORS cheklovlari amal qilmaydi.
import type { LoginResponse, User, Chat, Message, KeyBundle } from "@/types";

// Dev rejimida Vite proxy ishlatiladi (TLS sertifikat muammosini hal qiladi).
// Production build'da to'g'ridan-to'g'ri Go serverga murojaat qilinadi.
const BASE_URL = import.meta.env.PROD
  ? "https://server.lokal:8443/api/v1"
  : "/api/v1";

// So'rov sarlavhalari token bilan birga qaytariladi
function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// Umumiy so'rov yuboruvchi yordamchi funksiya
async function request<T>(
  method: string,
  path:   string,
  token?: string,
  body?:  unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(token),
    body:    body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status.toString());
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  // 204 No Content holatida bo'sh ob'ekt qaytariladi
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ── Autentifikatsiya ────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>("POST", "/auth/login", undefined, { username, password }),

  logout: (token: string) =>
    request<void>("POST", "/auth/logout", token),

  changePassword: (token: string, oldPwd: string, newPwd: string) =>
    request<void>("POST", "/auth/change-password", token, {
      old_password: oldPwd,
      new_password: newPwd,
    }),
};

// ── Foydalanuvchilar ────────────────────────────────────────────────
export const userApi = {
  me: (token: string) =>
    request<Pick<User, "id" | "username" | "role">>("GET", "/me", token),

  list: (token: string) =>
    request<User[]>("GET", "/users", token),

  // Faqat admin uchun
  create: (token: string, data: Partial<User> & { role: string }) =>
    request<{ user_id: string; temporary_password: string }>(
      "POST", "/admin/users", token, data
    ),

  setActive: (token: string, userId: string, active: boolean) =>
    request<void>("PATCH", `/admin/users/${userId}/active`, token, { is_active: active }),
};

// ── Suhbatlar ───────────────────────────────────────────────────────
export const chatApi = {
  list: (token: string) =>
    request<Chat[]>("GET", "/chats", token),

  create: (token: string, type: "private" | "group", memberIds: string[], title?: string) =>
    request<Chat>("POST", "/chats", token, { type, member_ids: memberIds, title }),

  history: (token: string, chatId: string, before?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    return request<Message[]>("GET", `/chats/${chatId}/messages?${params}`, token);
  },
};

// ── Signal Protocol kalitlari ───────────────────────────────────────
export const keysApi = {
  upload: (token: string, bundle: KeyBundle) =>
    request<void>("POST", "/keys/upload", token, bundle),

  getBundle: (token: string, userId: string) =>
    request<KeyBundle>("GET", `/keys/${userId}/bundle`, token),
};
