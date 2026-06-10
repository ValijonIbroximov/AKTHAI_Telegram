// Server bilan HTTP/REST muloqot qiluvchi qatlam.
import type { LoginResponse, User, Chat, Message, KeyBundle, RawChat, RawMessage, UserProfile, ProfileEditPolicy } from "@/types";
import { getApiBaseUrl } from "@/config/devServer";

export { getApiBaseUrl };

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
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
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

/** Profil surati URL (WebSocket kabi query token) */
export function buildAvatarUrl(userId: string, token: string, cacheKey = ""): string {
  const base = `${getApiBaseUrl()}/avatars/${userId}?token=${encodeURIComponent(token)}`;
  return cacheKey ? `${base}&v=${encodeURIComponent(cacheKey)}` : base;
}

async function requestForm<T>(
  method: string,
  path: string,
  token: string,
  form: FormData,
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
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

  dismissPasswordChange: (token: string) =>
    request<void>("POST", "/auth/dismiss-password-change", token, {}),
};

// ── Foydalanuvchilar ──────────────────────────────────────────────────────────
interface MeResponse {
  user_id:            string;
  role:               string;
  hide_last_seen:     boolean;
  can_create_channel?: boolean;
}

export const userApi = {
  me: (token: string) =>
    request<MeResponse>("GET", "/me", token),

  updatePrivacy: (token: string, data: { hide_last_seen: boolean }) =>
    request<{ hide_last_seen: boolean }>("PATCH", "/me/privacy", token, data),

  list: (token: string) =>
    request<User[]>("GET", "/users", token),

  search: (token: string, q: string) =>
    request<User[]>("GET", `/users?q=${encodeURIComponent(q)}`, token),

  directory: (token: string) =>
    request<User[]>("GET", "/users/directory", token),

  create: (token: string, data: Partial<User> & { role: string }) =>
    request<{ user_id: string; temporary_password: string }>(
      "POST", "/admin/users", token, data
    ),

  setActive: (token: string, userId: string, active: boolean) =>
    request<void>("PATCH", `/admin/users/${userId}/active`, token, { is_active: active }),
};

export const profileApi = {
  get: (token: string) =>
    request<UserProfile>("GET", "/me/profile", token),

  update: (token: string, data: Partial<Record<string, string>>) =>
    request<void>("PATCH", "/me/profile", token, data),

  uploadAvatar: (token: string, file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return requestForm<{ has_avatar: boolean }>("POST", "/me/avatar", token, fd);
  },

  deleteAvatar: (token: string) =>
    request<void>("DELETE", "/me/avatar", token),
};

export interface AdminStats {
  total_users:    number;
  active_users:   number;
  locked_users:   number;
  admin_count:    number;
  online_now:     number;
  total_chats:    number;
  private_chats:  number;
  group_chats:    number;
  total_messages: number;
}

export interface AdminChat {
  id:            string;
  type:          string;
  title:         string;
  created_at:    string;
  member_count:  number;
  message_count: number;
  last_activity: string | null;
}

export interface AdminChatMember {
  id:           string;
  username:     string;
  display_name: string;
}

export interface AdminChatMessage {
  msg_id:          string;
  sender_id:       string;
  sender_username: string;
  sender_name:     string;
  msg_type:        number;
  created_at:      string;
  size_bytes:      number;
  delivered:       boolean;
  read:            boolean;
}

export interface AdminChatDetail {
  chat: {
    id:      string;
    type:    string;
    title:   string;
    members: AdminChatMember[];
  };
  messages: AdminChatMessage[];
  total:    number;
  limit:    number;
  offset:   number;
}

export interface AuditEntry {
  id:         number;
  actor_id:   string;
  action:     string;
  target_id:  string;
  ip:         string;
  created_at: string;
  username:   string;
}

export const adminApi = {
  stats: (token: string) =>
    request<AdminStats>("GET", "/admin/stats", token),

  listUsers: (token: string) =>
    request<User[]>("GET", "/admin/users", token),

  createUser: (token: string, data: Partial<User> & { role: string; password?: string }) =>
    request<{ user_id: string; temporary_password: string }>("POST", "/admin/users", token, data),

  updateUser: (token: string, id: string, data: Partial<User> & { password?: string }) =>
    request<void>("PUT", `/admin/users/${id}`, token, data),

  setActive: (token: string, id: string, active: boolean) =>
    request<void>("PATCH", `/admin/users/${id}/active`, token, { is_active: active }),

  deleteUser: (token: string, id: string) =>
    request<void>("DELETE", `/admin/users/${id}`, token),

  resetPassword: (token: string, id: string, password?: string) =>
    request<{ temporary_password: string }>("POST", `/admin/users/${id}/reset-password`, token,
      password ? { password } : {}),

  getUserPresence: (token: string, id: string) =>
    request<{ user_id: string; online: boolean; last_seen_at: string | null; hide_last_seen: boolean }>(
      "GET", `/admin/users/${id}/presence`, token),

  listChats: (token: string) =>
    request<AdminChat[]>("GET", "/admin/chats", token),

  chatMessages: (token: string, chatId: string, opts?: { limit?: number; offset?: number }) => {
    const p = new URLSearchParams();
    if (opts?.limit)  p.set("limit",  String(opts.limit));
    if (opts?.offset) p.set("offset", String(opts.offset));
    const qs = p.toString() ? `?${p}` : "";
    return request<AdminChatDetail>("GET", `/admin/chats/${chatId}/messages${qs}`, token);
  },

  auditLog: (token: string, opts?: { limit?: number; offset?: number; action?: string }) => {
    const p = new URLSearchParams();
    if (opts?.limit)  p.set("limit",  String(opts.limit));
    if (opts?.offset) p.set("offset", String(opts.offset));
    if (opts?.action) p.set("action", opts.action);
    const qs = p.toString() ? `?${p}` : "";
    return request<AuditEntry[]>("GET", `/admin/audit-log${qs}`, token);
  },

  getProfilePolicy: (token: string) =>
    request<{ policy: ProfileEditPolicy; fields: string[] }>("GET", "/admin/profile-policy", token),

  setProfilePolicy: (token: string, policy: ProfileEditPolicy) =>
    request<void>("PUT", "/admin/profile-policy", token, { policy }),
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

function normalizeCreatedAt(v: unknown): string {
  if (typeof v === "string" && v.trim()) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  return new Date().toISOString();
}

function msgStatus(delivered: boolean, read: boolean): Message["status"] {
  if (read) return "read";
  if (delivered) return "delivered";
  return "sent";
}

export interface HistoryRow {
  message:       Message;
  serverMsgType: number;
}

export const chatApi = {
  list: async (token: string): Promise<Chat[]> => {
    const raw = await request<RawChat[]>("GET", "/chats", token);
    return (raw ?? []).map((c) => ({
      id:                 c.id,
      type:               c.type,
      title:              c.title || "Nomsiz",
      description:        c.description ?? null,
      peer_user_id:       c.peer_user_id ?? null,
      peer_online:           c.peer_online,
      peer_last_seen_at:     c.peer_last_seen_at ?? null,
      peer_last_seen_hidden: c.peer_last_seen_hidden ?? false,
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

  createChannel: async (
    token: string,
    title: string,
    description?: string,
  ): Promise<{ id: string; existing: boolean }> =>
    request<{ id: string; existing: boolean }>("POST", "/chats", token, {
      type:        "channel",
      title,
      description: description ?? "",
    }),

  history: async (token: string, chatId: string, limit = 100): Promise<Message[]> => {
    const rows = await chatApi.historyRaw(token, chatId, limit);
    return rows.map((r) => r.message);
  },

  /** Server msg_type bilan birga — kanal (10) va Signal (1/3) deshifrlash uchun */
  historyRaw: async (token: string, chatId: string, limit = 100): Promise<HistoryRow[]> => {
    const raw = await request<RawMessage[]>(
      "GET", `/chats/${chatId}/messages?limit=${limit}`, token
    );
    return (raw ?? []).map((m) => ({
      serverMsgType: m.msg_type,
      message: {
        id:         m.msg_id,
        chat_id:    chatId,
        sender_id:  m.sender_id,
        ciphertext: m.ciphertext,
        plaintext:  null,
        msg_type:   msgTypeNum(m.msg_type),
        status:     msgStatus(m.delivered, m.read),
        created_at: normalizeCreatedAt(m.created_at),
      },
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
  const base = getApiBaseUrl();
  if (!base.startsWith("http")) return "";
  try {
    return new URL(base).origin;
  } catch {
    return base.replace(/\/api\/v1.*$/, "");
  }
}

/** POST /api/v1/upload — to'liq manzil (proxy yoki to'g'ridan-to'g'ri) */
function uploadEndpoint(): string {
  return `${getApiBaseUrl()}/upload`;
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

    const url = uploadEndpoint();
    let res: Response;
    try {
      // MUHIM: Content-Type qo'lda BERILMAYDI — brauzer multipart boundary ni o'zi qo'shadi.
      // Faqat Authorization sarlavhasi qoldiriladi.
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Fayl yuklanmadi: serverga ulanib bo'lmadi (${msg})`);
    }

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
