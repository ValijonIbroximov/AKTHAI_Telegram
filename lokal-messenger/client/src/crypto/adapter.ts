// Platform adapter: Tauri (Rust) yoki Brauzer (Web Crypto API) muhitini avtomatik aniqlaydi.
import {
  webEncryptMessage,
  webDecryptMessage,
  webEstablishSession,
  webEstablishSessionReceiver,
  webInitSignalKeys,
  webHasSession,
  getWebIdentityPublicKeyB64,
  type WebEstablishResult,
} from "./webCrypto";

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

// ── X3DH Sessiya o'rnatish (yuboruvchi tomoni) ────────────────────────────────
// Qaytaradi: { ekPk, senderIkX25519, spkKeyId, otpkKeyId }

export interface EstablishResult {
  ekPk:           string;
  senderIkX25519: string;
  spkKeyId:       number;
  otpkKeyId:      number;
}

export async function establishSession(
  peerId:     string,
  bundleJson: string
): Promise<EstablishResult> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<EstablishResult>("establish_session", { peerId, bundleJson });
  }
  const r: WebEstablishResult = await webEstablishSession(peerId, bundleJson);
  return {
    ekPk:           r.ekPk,
    senderIkX25519: r.senderIkX25519,
    spkKeyId:       r.spkKeyId,
    otpkKeyId:      r.otpkKeyId,
  };
}

// ── X3DH Sessiya o'rnatish (qabul qiluvchi tomoni) ────────────────────────────

export async function establishSessionReceiver(
  peerId:             string,
  peerEkPkB64:        string,
  senderIkX25519B64:  string,
  spkKeyId:           number,
  otpkKeyId:          number
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("establish_session_receiver", {
      peerId,
      peerEkPkB64,
      senderIkX25519B64,
      spkKeyId,
      otpkKeyId,
    });
  }
  return webEstablishSessionReceiver(peerId, peerEkPkB64, senderIkX25519B64, spkKeyId, otpkKeyId);
}

// ── Sessiya mavjudligini tekshirish ───────────────────────────────────────────

export async function hasSession(peerId: string): Promise<boolean> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("has_session", { peerId });
  }
  return webHasSession(peerId);
}

// ── Signal kalitlarini ishga tushirish + yuklash ──────────────────────────────

export async function initSignalKeys(token: string, userId: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("init_signal_keys", { token, userId });
  }
  // Brauzer: kalit generatsiya + server yuklash
  return webInitSignalKeys(token);
}

// ── Identifikatsiya kaliti (key_exchange uchun) ───────────────────────────────

export async function getIdentityPublicKeyB64(): Promise<string> {
  if (isTauri) {
    // Tauri'da IK pub key init_signal_keys paytida serverga yuklangan
    // Uni DB'dan o'qishimiz kerak — hozircha serverdan olamiz (bu safe)
    // Oddiy yechim: server /me emas, storage'dan o'qish. Hozircha brauzer kabi ishlaymiz.
    // TODO: add get_identity_pk Tauri command if needed
    return "";
  }
  return getWebIdentityPublicKeyB64();
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
