// Platform adapter: Tauri (Rust) yoki Brauzer (Web Crypto API) muhitini avtomatik aniqlaydi.
import { webEncryptMessage, webDecryptMessage, webEstablishSession } from "./webCrypto";

export const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

// ── Xabar shifrlash ───────────────────────────────────────────────────────────

export async function encryptMessage(
  chatId:      string,
  recipientId: string,
  plaintext:   string
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("encrypt_message", { chatId, recipientId, plaintext });
  }
  return webEncryptMessage(recipientId, plaintext);
}

// ── Xabar shifr ochish ────────────────────────────────────────────────────────

export async function decryptMessage(
  chatId:     string,
  senderId:   string,
  ciphertext: string
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("decrypt_message", { chatId, senderId, ciphertext });
  }
  return webDecryptMessage(senderId, ciphertext);
}

// ── X3DH Sessiya o'rnatish ────────────────────────────────────────────────────
// Birinchi xabar yuborishdan oldin sherik kalit-bundle asosida sessiya o'rnatiladi.

export async function establishSession(
  peerId:     string,
  bundleJson: string
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("establish_session", { peerId, bundleJson });
  }
  return webEstablishSession(peerId, bundleJson);
}

// ── Signal kalitlarini ishga tushirish ────────────────────────────────────────

export async function initSignalKeys(token: string, userId: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("init_signal_keys", { token, userId });
  }
  // Brauzer: IndexedDB ga kalit juftligi saqlanadi (webCrypto.ts ichida)
}

// ── Token saqlash ─────────────────────────────────────────────────────────────

export async function storeToken(token: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("store_token", { token });
  }
  sessionStorage.setItem("auth_token", token);
}

export async function clearToken(): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("clear_token");
  }
  sessionStorage.removeItem("auth_token");
}
