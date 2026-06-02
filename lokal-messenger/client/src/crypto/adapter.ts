// Platform adapter: Tauri (Rust) yoki Brauzer (Web Crypto API) muhitini avtomatik aniqlaydi.
// chatStore.ts va boshqa joylar to'g'ridan-to'g'ri invoke() o'rniga shu fayl orqali murojaat qiladi.

import { webEncryptMessage, webDecryptMessage } from "./webCrypto";

// Tauri muhiti aniqlash: __TAURI__ global oʻzgaruvchisi Tauri tomonidan qoʻshiladi
export const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

// ── Xabar shifrlash ────────────────────────────────────────────────────────

export async function encryptMessage(
  chatId:      string,
  recipientId: string,
  plaintext:   string
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("encrypt_message", { chatId, recipientId, plaintext });
  }
  // Brauzer rejimi: Web Crypto API orqali
  return webEncryptMessage(recipientId, plaintext);
}

// ── Xabar shifr ochish ─────────────────────────────────────────────────────

export async function decryptMessage(
  chatId:     string,
  senderId:   string,
  ciphertext: string
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("decrypt_message", { chatId, senderId, ciphertext });
  }
  // Brauzer rejimi
  return webDecryptMessage(senderId, ciphertext);
}

// ── Signal kalitlarini ishga tushirish ─────────────────────────────────────

export async function initSignalKeys(token: string, userId: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("init_signal_keys", { token, userId });
  }
  // Brauzer rejimi: kalitlar IndexedDB da saqlanadi (webCrypto.ts)
  // Hozircha server bilan sinxronizatsiya qilmaslik uchun skip
}

// ── Token saqlash ──────────────────────────────────────────────────────────

export async function storeToken(token: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("store_token", { token });
  }
  // Brauzer rejimi: sessionStorage ishlatiladi
  sessionStorage.setItem("auth_token", token);
}

export async function clearToken(): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("clear_token");
  }
  sessionStorage.removeItem("auth_token");
}
