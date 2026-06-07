// Tauri v2 + brauzer Notification API + ichki toast bildirishnomalar
import { isTauri } from "@/crypto/adapter";
import { isReadablePlaintext } from "@/utils/messageText";
import { avatarIconUrl } from "@/utils/avatarGradient";
import appIconUrl from "../../src-tauri/icons/32x32.png?url";

let permGranted = false;
let initAttempted = false;
/** MessageArea ko'rinishida (sozlamalar/admin emas) */
let chatPaneVisible = true;
let clickHandler: ((chatId: string) => void) | null = null;

/** GC oldini olish — click handler ishlashi uchun */
const activeNotifs = new Map<string, Notification>();

export interface ToastItem {
  id:         string;
  chatId:     string;
  senderName: string;
  preview:    string;
}

let toasts: ToastItem[] = [];
const toastListeners = new Set<(items: ToastItem[]) => void>();

function emitToasts(): void {
  const snapshot = [...toasts];
  toastListeners.forEach((fn) => fn(snapshot));
}

export function subscribeToasts(listener: (items: ToastItem[]) => void): () => void {
  toastListeners.add(listener);
  listener([...toasts]);
  return () => toastListeners.delete(listener);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

function pushToast(chatId: string, senderName: string, preview: string): void {
  const body = preview.length > 140 ? preview.slice(0, 137) + "…" : preview;
  toasts = [
    { id: `${chatId}-${Date.now()}`, chatId, senderName, preview: body },
    ...toasts.filter((t) => t.chatId !== chatId),
  ].slice(0, 4);
  emitToasts();
}

export function setChatPaneVisible(visible: boolean): void {
  chatPaneVisible = visible;
}

export function setNotificationClickHandler(
  handler: ((chatId: string) => void) | null,
): void {
  clickHandler = handler;
}

export async function openNotificationTarget(chatId: string): Promise<void> {
  await focusAppWindow();
  clickHandler?.(chatId);
}

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

async function isWindowFocused(): Promise<boolean> {
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return await getCurrentWindow().isFocused();
    } catch {
      return document.hasFocus();
    }
  }
  return document.hasFocus();
}

export async function shouldNotifyIncoming(
  chatId:       string,
  activeChatId: string | null,
): Promise<boolean> {
  const viewingChat = chatPaneVisible && activeChatId === chatId;
  const visible     = document.visibilityState === "visible";

  if (viewingChat && visible) {
    if (await isWindowFocused()) return false;
  }

  return true;
}

async function focusAppWindow(): Promise<void> {
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.show();
      await win.unminimize();
      await win.setFocus();
      return;
    } catch {
      /* brauzer fallback */
    }
  }
  window.focus();
}

function attachClickHandler(n: Notification, chatId: string): void {
  n.onclick = (ev) => {
    ev.preventDefault();
    n.close();
    activeNotifs.delete(chatId);
    void openNotificationTarget(chatId);
  };
  n.onclose = () => activeNotifs.delete(chatId);
}

function showOsNotification(
  senderName: string,
  preview:    string,
  chatId:     string,
): void {
  if (!permGranted || typeof Notification === "undefined") return;

  const title = senderName?.trim() || "Yangi xabar";
  const body  = preview.length > 120 ? preview.slice(0, 117) + "…" : preview;
  const icon  = avatarIconUrl(senderName) || appIconUrl;

  try {
    const prev = activeNotifs.get(chatId);
    prev?.close();

    const n = new Notification(title, {
      body,
      tag:  chatId,
      icon,
      badge: appIconUrl,
    });
    activeNotifs.set(chatId, n);
    attachClickHandler(n, chatId);

    console.log(`[Notify] 🔔 OS bildirishnoma: chat=${chatId}`);
  } catch (e) {
    console.warn("[Notify] ⚠ Notification xatoligi:", e);
  }
}

export async function notifyIncomingMessage(
  senderName: string,
  preview:    string,
  chatId:     string,
): Promise<void> {
  if (!isReadablePlaintext(preview)) return;

  const visible = document.visibilityState === "visible";
  const focused = await isWindowFocused();

  if (visible) {
    pushToast(chatId, senderName, preview);
  }

  if (!visible || !focused) {
    showOsNotification(senderName, preview, chatId);
  }
}
