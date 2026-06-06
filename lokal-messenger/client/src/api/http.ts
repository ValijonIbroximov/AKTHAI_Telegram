// Server bilan HTTP/REST muloqot qiluvchi qatlam.
import type { LoginResponse, User, Chat, Message, KeyBundle, RawChat, RawMessage } from "@/types";

function getBaseUrl(): string {
  // Dev yoki SPA Go server bilan bir xil portda — Vite proxy / relative yo'l
  if (import.meta.env.DEV || window.location.port === "8443") {
    return "/api/v1";
  }
  return `https://${window.location.hostname}:8443/api/v1`;
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function request<T>(
  method: string,
  path:   string,
  token?: string,
  body?:  unknown
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: headers(token),
    body:    body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status.toString());
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ── Autentifikatsiya ──────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>("POST", "/auth/login", undefined, { username, password }),

  logout: (token: string) =>
    request<void>("POST", "/auth/logout", token),

  changePassword: (token: string, oldPwd: string, newPwd: string) =>
    request<void>("PUT", "/auth/password", token, {
      old_password: oldPwd,
      new_password: newPwd,
    }),
};

// ── Foydalanuvchilar ──────────────────────────────────────────────────────────
interface MeResponse { user_id: string; role: string }

export const userApi = {
  me: (token: string) =>
    request<MeResponse>("GET", "/me", token),

  list: (token: string) =>
    request<User[]>("GET", "/users", token),

  search: (token: string, q: string) =>
    request<User[]>("GET", `/users?q=${encodeURIComponent(q)}`, token),

  create: (token: string, data: Partial<User> & { role: string }) =>
    request<{ user_id: string; temporary_password: string }>(
      "POST", "/admin/users", token, data
    ),

  setActive: (token: string, userId: string, active: boolean) =>
    request<void>("PATCH", `/admin/users/${userId}/active`, token, { is_active: active }),
};

// ── Suhbatlar ─────────────────────────────────────────────────────────────────
// msg_type raqamlarni string ga o'girish:
//   1 = text (SignalMessage)
//   2 = file
//   3 = text ham (PreKeySignalMessage — ciphertext ichida kalit almashinuvi yashiringan)
function msgTypeNum(n: number): Message["msg_type"] {
  if (n === 2) return "file";
  return "text"; // 1 va 3 ikkisi ham text — deshifrlash adapter ichida avtomatik
}

function msgStatus(delivered: boolean, read: boolean): Message["status"] {
  if (read) return "read";
  if (delivered) return "delivered";
  return "sent";
}

export const chatApi = {
  list: async (token: string): Promise<Chat[]> => {
    const raw = await request<RawChat[]>("GET", "/chats", token);
    return (raw ?? []).map((c) => ({
      id:           c.id,
      type:         c.type,
      title:        c.title || "Nomsiz",
      peer_user_id: c.peer_user_id ?? null,
      last_message: c.last_time
        ? { sender_id: "", preview: "", created_at: c.last_time }
        : null,
      unread_count: c.unread ?? 0,
      updated_at:   c.last_time ?? new Date().toISOString(),
    }));
  },

  // Shaxsiy suhbat yaratish: peer_user_id jo'natiladi
  createPrivate: async (token: string, peerUserId: string): Promise<{ id: string; existing: boolean }> =>
    request<{ id: string; existing: boolean }>("POST", "/chats", token, {
      type:         "private",
      peer_user_id: peerUserId,
    }),

  history: async (token: string, chatId: string, limit = 100): Promise<Message[]> => {
    const raw = await request<RawMessage[]>(
      "GET", `/chats/${chatId}/messages?limit=${limit}`, token
    );
    return (raw ?? []).reverse().map((m) => ({
      id:         m.msg_id,
      chat_id:    chatId,
      sender_id:  m.sender_id,
      ciphertext: m.ciphertext,
      plaintext:  null,
      msg_type:   msgTypeNum(m.msg_type),
      status:     msgStatus(m.delivered, m.read),
      created_at: typeof m.created_at === "string"
        ? m.created_at
        : new Date(m.created_at as unknown as number).toISOString(),
    }));
  },
};

// ── Signal Protocol kalitlari ─────────────────────────────────────────────────
export const keysApi = {
  upload: (token: string, bundle: KeyBundle) =>
    request<void>("POST", "/keys/upload", token, bundle),

  getBundle: (token: string, userId: string) =>
    request<KeyBundle>("GET", `/keys/${userId}/bundle`, token),
};

// ── Media (shifrlangan fayl yuklash / yuklab olish) ───────────────────────────
//
// Server faqat shifrlangan blob qabul qiladi/uzatadi.
// AES kalit va IV Signal Protocol xabari orqali jo'natiladi.

// ── Media URL yordamchisi ──────────────────────────────────────────────────
//
function mediaOrigin(): string {
  const base = getBaseUrl();
  if (!base.startsWith("http")) return "";
  try {
    return new URL(base).origin;
  } catch {
    return base.replace(/\/api\/v1.*$/, "");
  }
}

export const mediaApi = {
  /**
   * Shifrlangan blob'ni serverga yuklaydi.
   * Multipart/form-data, fayl maydoni nomi: "data".
   * Qaytariladi: { id: string, url: string }  (url = /api/v1/files/{id})
   */
  uploadFile: async (token: string, blob: Blob): Promise<{ id: string; url: string }> => {
    if (!token) throw new Error("Token yo'q — tizimga kiring");
    const form = new FormData();
    form.append("data", blob, "encrypted.bin");

    const res = await fetch(`${getBaseUrl()}/upload`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => String(res.status));
      throw new Error(`Fayl yuklanmadi (${res.status}): ${txt}`);
    }
    return res.json() as Promise<{ id: string; url: string }>;
  },

  /**
   * Serverdan shifrlangan blob'ni yuklab oladi.
   * `filePath` = "/api/v1/files/{id}"  yoki to'liq "https://..." URL.
   * Authorization: Bearer {token} sarlavhasi qo'shiladi.
   */
  downloadFile: async (token: string, filePath: string): Promise<Blob> => {
    if (!token) throw new Error("Token yo'q — tizimga kiring");

    // To'liq URL quriladi: dev'da relative ("/api/v1/..."), prod'da absolute
    const fetchUrl = filePath.startsWith("http")
      ? filePath
      : `${mediaOrigin()}${filePath}`;

    const res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Fayl yuklab olinmadi: HTTP ${res.status}${txt ? ` — ${txt}` : ""}`);
    }
    return res.blob();
  },
};
