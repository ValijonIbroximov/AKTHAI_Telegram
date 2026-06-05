// Tauri v2 tizim bildirishnomalari — Windows / macOS / Linux
// @tauri-apps/plugin-notification v2 API
//
// QOIDA: Bildirishnoma faqat:
//   1) Tauri muhitida (brauzerda yo'q)
//   2) Ruxsat berilganda
//   3) Xabar muvaffaqiyatli deshifrlanganda (isReadablePlaintext)
//   4) Foydalanuvchi shu chatda faol bo'lmaganda YOKI oyna fokusda bo'lmaganda

import { isTauri } from "@/crypto/adapter";
import { isReadablePlaintext } from "@/utils/messageText";

let permGranted = false;
let initAttempted = false;

/**
 * Ilova yuklanganda yoki akkaunt almashganda chaqiriladi.
 * Ruxsat so'raladi, natija module-level flag da saqlanadi.
 */
export async function initNotifications(): Promise<void> {
  if (!isTauri) return;
  if (initAttempted && permGranted) return;   // Allaqachon muvaffaqiyatli initsializatsiya
  initAttempted = true;

  try {
    const notif = await import("@tauri-apps/plugin-notification");

    let granted = await notif.isPermissionGranted();
    if (!granted) {
      const result = await notif.requestPermission();
      granted = result === "granted";
    }
    permGranted = granted;
    console.log(`[Notify] ✅ Ruxsat: ${granted ? "berildi" : "rad etildi"}`);
  } catch (e) {
    console.warn("[Notify] ⚠ initNotifications xatoligi:", e);
    permGranted = false;
  }
}

/**
 * Bildirishnoma chiqarish kerakmi?
 * Agar foydalanuvchi aynan o'sha chat ichida aktiv bo'lsa — YO'Q.
 * Aks holda — HA.
 */
export async function shouldNotifyIncoming(
  chatId:       string,
  activeChatId: string | null,
): Promise<boolean> {
  if (!isTauri || !permGranted) return false;

  const sameChat = activeChatId === chatId;
  const visible  = document.visibilityState === "visible";

  // Aynan shu chat ochiq va ko'rinib turibdi — fokusni ham tekshiramiz
  if (sameChat && visible) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const focused = await getCurrentWindow().isFocused();
      if (focused) return false;
    } catch {
      // Tauri window API ishlamasa — document.hasFocus() bilan tekshiramiz
      if (document.hasFocus()) return false;
    }
  }

  return true;
}

/**
 * Kiruvchi xabar uchun OS tizim bildirishnomasini ko'rsatadi.
 * @param senderName — jo'natuvchi nomi (chat title)
 * @param preview    — xabar matni (deshifrlangan ochiq matn)
 * @param chatId     — suhbat identifikatori (log uchun)
 */
export async function notifyIncomingMessage(
  senderName: string,
  preview:    string,
  chatId:     string,
): Promise<void> {
  if (!isTauri || !permGranted) return;
  if (!isReadablePlaintext(preview)) return;   // Pending/error label → bildirishnoma yo'q

  const title = senderName?.trim() || "Yangi xabar";
  const body  = preview.length > 120 ? preview.slice(0, 117) + "…" : preview;

  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    await sendNotification({ title, body });
    console.log(`[Notify] 🔔 Bildirishnoma yuborildi: chat=${chatId}`);
  } catch (e) {
    console.warn("[Notify] ⚠ sendNotification xatoligi:", e);
  }
}
