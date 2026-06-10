/** UI / saqlash uchun ochiq matn yaroqliligini tekshirish */

export const PENDING_DECRYPT_LABEL   = "⏳ Sessiya kutilmoqda…";
export const DECRYPT_FAIL_LABEL      = "⚠ Deshifrlashda xatolik";
/** Xabar bu qurilmada hech qachon saqlanmagan (serverdan tarix yuklanganida ratchet davlat yo'q) */
export const MISSING_PLAINTEXT_LABEL = "🔒 Qurilmada saqlanmagan";
/** Sessiya sinxronizatsiyasi — UI da ko'rsatilmaydi */
export const SESSION_SYNC_PLAINTEXT  = "\u2060";

export function isSessionSyncPlaintext(text: string | null | undefined): boolean {
  return text === SESSION_SYNC_PLAINTEXT;
}

/** Mahalliy bazaga va UI da ko'rsatish uchun yaroqli ochiq matn */
export function isReadablePlaintext(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  if (text === PENDING_DECRYPT_LABEL)   return false;
  if (text === DECRYPT_FAIL_LABEL)      return false;
  if (text === MISSING_PLAINTEXT_LABEL) return false;
  if (text === SESSION_SYNC_PLAINTEXT)  return false;
  if (text.startsWith("⚠") || text.startsWith("🔒")) return false;
  return true;
}
