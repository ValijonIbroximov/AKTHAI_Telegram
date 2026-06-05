// Platform adapter: Tauri (Rust) yoki Brauzer (Web Crypto API) muhitini avtomatik aniqlaydi.
import {
  webEncryptMessage,
  webEncryptFirstMessage,
  webDecryptMessage,
  webEstablishSession,
  webEstablishSessionReceiver,
  webInitSignalKeys,
  webHasSession,
  webClearSession,
  webClearAllSessions,
  webEnsureCryptoReady,
  webListSessionPeers,
  getWebIdentityPublicKeyB64,
  normalizePayload,
  type WebEstablishResult,
  type KeyInitResult,
} from "./webCrypto";

export type { KeyInitResult };
import {
  DecryptError,
  classifyDecryptError,
  logDecryptError,
} from "./cryptoErrors";

export { DecryptError, classifyDecryptError, logDecryptError };

/** UI da ko'rsatiladigan deshifrlash xatoligi (faqat haqiqiy xato bo'lganda) */
export const DECRYPT_ERROR_LABEL = "⚠ Deshifrlashda xatolik";

import {
  setActiveCryptoUserId,
  getActiveCryptoUserId,
  scopedIdbName,
} from "./userScope";

export const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

/** Multi-account: kripto kalitlari va sessiyalar foydalanuvchi bo'yicha izolyatsiya */
export async function setCryptoUser(userId: string): Promise<void> {
  console.log(`[E2EE] setCryptoUser → ${userId}`);
  setActiveCryptoUserId(userId);
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("set_active_user", { userId });
    console.log(`[E2EE] Tauri set_active_user OK: signal_${userId}.db`);
  } else {
    console.log(`[E2EE] IndexedDB: ${scopedIdbName()}`);
  }
}

/**
 * Account switch: crypto kontekstini to'liq yangilaydi.
 * Tartib: setCryptoUser → token → initSignalKeys → ensureCryptoReady
 */
export async function activateCryptoContext(
  userId: string,
  token:  string
): Promise<void> {
  await setCryptoUser(userId);
  if (getActiveCryptoUserId() !== userId) {
    throw new Error(`Crypto userId sinxron emas: ${getActiveCryptoUserId()} != ${userId}`);
  }
  await storeToken(token);
  const keyInit = await initSignalKeys(token, userId);
  if (keyInit.regenerated) {
    console.warn("[E2EE] Mahalliy kalitlar qayta yaratildi — server overwrite bajarildi");
  }
  await ensureCryptoReady(userId);
}

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

/**
 * Birinchi xabar: X3DH + shifrlash bir bosqichda (PreKeySignalMessage, Type 3).
 * Sessiya yo'q bo'lganda ishlatiladi.
 * Server bu xabarni oddiy message kabi DB ga saqlaydi → offline yetkazish ishlaydi.
 */
export async function encryptFirstMessage(
  chatId:     string,
  peerId:     string,
  bundleJson: string,
  plaintext:  string,
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    // Step 1: X3DH — sessiya yaratish
    const result = await invoke<EstablishResult>("establish_session", { peerId, bundleJson });
    // Step 2: Xabarni shifrlash (sessiya endi mavjud)
    const inner = await invoke<string>("encrypt_message", { chatId, recipientId: peerId, plaintext });
    // Step 3: PreKeyMessage formatida birlashtirish
    return JSON.stringify({
      type:   3,
      prekey: {
        ek_pk:       result.ekPk,
        sender_ik:   result.senderIkX25519,
        spk_key_id:  result.spkKeyId,
        otpk_key_id: result.otpkKeyId,
      },
      inner,
    });
  }
  return webEncryptFirstMessage(peerId, bundleJson, plaintext);
}

// ── Xabar shifr ochish ────────────────────────────────────────────────────────
//
// PreKeyMessage (Type 3) avtomatik aniqlash:
//   payload JSON da `type: 3` va `prekey` bo'lsa:
//     1. establishSessionReceiver → sessiya yaratish
//     2. inner payload ni qayta deshifrlash (oddiy SignalMessage)
//
// Bu mantiq adapter darajasida Tauri va brauzer uchun umumiy ishlaydi.
// Brauzer webDecryptMessage ham o'z ichida Type 3 ni qo'llab-quvvatlaydi (qo'shimcha himoya).

export async function decryptMessage(
  chatId:     string,
  senderId:   string,
  ciphertext: string
): Promise<string> {
  const raw = ciphertext?.trim() ?? "";
  if (!raw) {
    const err = new DecryptError("CIPHERTEXT_MISSING", "Bo'sh ciphertext");
    logDecryptError({ peerId: senderId, chatId }, err);
    throw err;
  }

  const payload = normalizePayload(raw);

  // ── PreKeyMessage (Type 3) tekshiruvi ───────────────────────────────────
  // JSON bo'lsa va type=3 ko'rsatilgan bo'lsa, X3DH sessiyasini o'rnatib deshifraymiz.
  // Bu Tauri va brauzer uchun adapter darajasida bir xil ishlaydi.
  try {
    const parsed = JSON.parse(payload) as {
      type?: number;
      prekey?: { ek_pk: string; sender_ik: string; spk_key_id?: number; otpk_key_id?: number };
      inner?: string;
    };
    if (parsed.type === 3 && parsed.prekey && parsed.inner) {
      const pk = parsed.prekey;
      await establishSessionReceiver(
        senderId,
        pk.ek_pk,
        pk.sender_ik,
        pk.spk_key_id  ?? 0,
        pk.otpk_key_id ?? 0,
      );
      // Ichki xabarni deshifrlash (rekursiv → oddiy SignalMessage kabi)
      return await decryptMessage(chatId, senderId, parsed.inner);
    }
  } catch (e) {
    // DecryptError bo'lsa qayta throw qilamiz (genuine xato)
    if (e instanceof DecryptError) throw e;
    // JSON parse xatosi yoki boshqa — oddiy deshifrlashga o'tamiz
  }
  // ────────────────────────────────────────────────────────────────────────

  // Oddiy SignalMessage (Type 1 yoki legacy format)
  try {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("decrypt_message", { chatId, senderId, ciphertext: payload });
    }
    return await webDecryptMessage(senderId, payload);
  } catch (e) {
    const err = classifyDecryptError(e);
    logDecryptError({ peerId: senderId, chatId }, err);
    throw err;
  }
}

/** Login / refresh / account switch: to'g'ri DB ga ulanganini tekshiradi */
export async function ensureCryptoReady(expectedUserId?: string): Promise<void> {
  const uid = getActiveCryptoUserId();
  if (expectedUserId && uid !== expectedUserId) {
    throw new Error(
      `[E2EE] Crypto context mismatch: kutildi=${expectedUserId}, hozir=${uid ?? "null"}`
    );
  }
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const peers = await invoke<string[]>("list_session_peers").catch(() => []);
    console.log(
      `[E2EE] ✅ Tauri crypto ready user=${uid} sessions=${peers.length}`,
      peers.length ? peers : ""
    );
    return;
  }
  await webEnsureCryptoReady();
  console.log(`[E2EE] ✅ Web crypto ready user=${uid} idb=${scopedIdbName()}`);
}

export async function listSessionPeers(): Promise<string[]> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string[]>("list_session_peers");
  }
  return webListSessionPeers();
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

/** Berilgan peer bilan Signal sessiyasini o'chirish */
export async function clearSession(peerId: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("clear_peer_session", { peerId });
  }
  return webClearSession(peerId);
}

/** Barcha Signal sessiyalarini o'chirish */
export async function clearAllSessions(): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("clear_all_sessions");
  }
  return webClearAllSessions();
}

// ── Signal kalitlarini ishga tushirish + yuklash ──────────────────────────────

export async function initSignalKeys(token: string, userId: string): Promise<KeyInitResult> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<KeyInitResult>("init_signal_keys", { token, userId });
  }
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
