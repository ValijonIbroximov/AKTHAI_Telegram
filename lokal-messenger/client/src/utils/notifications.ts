// Tauri tizim bildirishnomalari (Windows / macOS / Linux)

import { isTauri } from "@/crypto/adapter";
import { isReadablePlaintext } from "@/utils/messageText";

let ready = false;

/** Ilova yuklanganda ruxsat so'raladi */
export async function initNotifications(): Promise<void> {
  if (!isTauri || ready) return;
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    ready = granted;
    console.log(`[Notify] ruxsat: ${granted ? "berildi" : "rad etildi"}`);
  } catch (e) {
    console.warn("[Notify] init xatoligi:", e);
  }
}

/** Bildirishnoma ko'rsatish kerakmi: boshqa chat yoki oyna fokusda emas */
export async function shouldNotifyIncoming(
  chatId: string,
  activeChatId: string | null
): Promise<boolean> {
  if (!isTauri || !ready) return false;

  const sameChat = activeChatId === chatId;
  const visible  = document.visibilityState === "visible";

  if (sameChat && visible) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (await getCurrentWindow().isFocused()) return false;
    } catch {
      if (document.hasFocus()) return false;
    }
  }
  return true;
}

/** Kiruvchi xabar uchun OS bildirishnomasi */
export async function notifyIncomingMessage(
  senderName: string,
  preview: string,
  chatId: string
): Promise<void> {
  if (!isTauri || !ready) return;
  if (!isReadablePlaintext(preview)) return;

  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    const body = preview.length > 120 ? preview.slice(0, 117) + "…" : preview;
    await sendNotification({
      title: senderName || "Yangi xabar",
      body,
    });
  } catch (e) {
    console.warn("[Notify] yuborish xatoligi:", e);
  }
}
