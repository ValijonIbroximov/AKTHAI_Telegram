// Fayl: client/src/net/api.ts
// Maqsad: Server REST API'siga so'rovlar yuboriladi (suhbatlar, foydalanuvchilar, tarix).
//         Kalit almashinuvi va shifrlash Rust tomonida bajariladi; bu yerda faqat
//         shifrlangan ma'lumotlar va metama'lumotlar uzatiladi.
import { SERVER_HTTP } from "../config";
import { useAuthStore } from "../stores/auth";

// request — token bilan himoyalangan so'rov yuboriladi va JSON natija qaytariladi.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const resp = await fetch(`${SERVER_HTTP}${path}`, { ...init, headers });
  if (resp.status === 204) {
    return undefined as T;
  }
  if (!resp.ok) {
    let message = `xato: ${resp.status}`;
    try {
      const body = await resp.json();
      if (body?.error) message = body.error;
    } catch {
      // Tana JSON bo'lmasa, standart xabar ishlatiladi
    }
    throw new Error(message);
  }
  return (await resp.json()) as T;
}

// Server REST chaqiruvlari guruhi
export const api = {
  // Foydalanuvchilar katalogi olinadi
  listUsers: () =>
    request<
      Array<{
        id: string;
        username: string;
        display_name: string;
        role: string;
        rank_title?: string;
        unit_code?: string;
      }>
    >("/api/v1/users"),

  // Joriy foydalanuvchining suhbatlari olinadi
  listChats: () =>
    request<
      Array<{
        id: string;
        type: string;
        title: string;
        peer_user_id?: string;
        last_time?: string;
        unread: number;
      }>
    >("/api/v1/chats"),

  // Yangi (yoki mavjud) shaxsiy suhbat yaratiladi
  createPrivateChat: (peerUserId: string) =>
    request<{ id: string; existing: boolean }>("/api/v1/chats", {
      method: "POST",
      body: JSON.stringify({ type: "private", peer_user_id: peerUserId }),
    }),

  // Suhbatdagi shifrlangan xabarlar tarixi olinadi
  chatHistory: (chatId: string) =>
    request<
      Array<{
        msg_id: string;
        sender_id: string;
        ciphertext: string;
        msg_type: number;
        created_at: string;
        delivered: boolean;
        read: boolean;
      }>
    >(`/api/v1/chats/${chatId}/messages`),

  // Joriy foydalanuvchi haqidagi ma'lumot olinadi
  me: () =>
    request<{
      user_id: string;
      username: string;
      display_name: string;
      role: string;
      must_change_password: boolean;
    }>("/api/v1/me"),

  // Parol almashtiriladi
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),
};
