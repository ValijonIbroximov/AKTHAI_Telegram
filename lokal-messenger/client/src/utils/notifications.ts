// Tauri v2 tizim bildirishnomalari + brauzer Notification API
import { isTauri } from "@/crypto/adapter";
import { isReadablePlaintext } from "@/utils/messageText";

let permGranted = false;
let initAttempted = false;

export async function initNotifications(): Promise<void> {
  if (initAttempted && permGranted) return;
  initAttempted = true;

  if (isTauri) {
    try {
      const notif = await import("@tauri-apps/plugin-notification");
      let granted = await notif.isPermissionGranted();
      if (!granted) {
        const result = await notif.requestPermission();
        granted = result === "granted";
      }
      permGranted = granted;
      console.log(`[Notify] ✅ Tauri ruxsat: ${granted ? "berildi" : "rad etildi"}`);
    } catch (e) {
      console.warn("[Notify] ⚠ initNotifications xatoligi:", e);
      permGranted = false;
    }
    return;
  }

  if (typeof Notification !== "undefined") {
    if (Notification.permission === "granted") {
      permGranted = true;
    } else if (Notification.permission !== "denied") {
      const result = await Notification.requestPermission();
      permGranted = result === "granted";
    }
    console.log(`[Notify] ✅ Brauzer ruxsat: ${permGranted ? "berildi" : "rad etildi"}`);
  }
}

export async function shouldNotifyIncoming(
  chatId:       string,
  activeChatId: string | null,
): Promise<boolean> {
  if (!permGranted) return false;

  const sameChat = activeChatId === chatId;
  const visible  = document.visibilityState === "visible";

  if (sameChat && visible) {
    if (isTauri) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (await getCurrentWindow().isFocused()) return false;
      } catch {
        if (document.hasFocus()) return false;
      }
    } else if (document.hasFocus()) {
      return false;
    }
  }

  return true;
}

export async function notifyIncomingMessage(
  senderName: string,
  preview:    string,
  chatId:     string,
): Promise<void> {
  if (!permGranted || !isReadablePlaintext(preview)) return;

  const title = senderName?.trim() || "Yangi xabar";
  const body  = preview.length > 120 ? preview.slice(0, 117) + "…" : preview;

  if (isTauri) {
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      await sendNotification({ title, body });
      console.log(`[Notify] 🔔 Bildirishnoma: chat=${chatId}`);
    } catch (e) {
      console.warn("[Notify] ⚠ sendNotification xatoligi:", e);
    }
    return;
  }

  if (typeof Notification !== "undefined") {
    try {
      new Notification(title, { body, tag: chatId });
      console.log(`[Notify] 🔔 Brauzer bildirishnoma: chat=${chatId}`);
    } catch (e) {
      console.warn("[Notify] ⚠ Notification xatoligi:", e);
    }
  }
}
