// Windows Action Center + Tauri native toast — ichki web toast ishlatilmaydi.
import { isTauri } from "@/crypto/adapter";
import { isReadablePlaintext } from "@/utils/messageText";
import { avatarIconUrl } from "@/utils/avatarGradient";
import appIconUrl from "../../src-tauri/icons/32x32.png?url";

const APP_NAME = "Harbiy Messenjer";

let permGranted = false;
let initAttempted = false;
let chatPaneVisible = true;
let clickHandler: ((chatId: string) => void) | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let tauriActionBound = false;

const activeBrowserNotifs = new Map<string, Notification>();

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

function chatNotifId(chatId: string): number {
  let h = 0;
  for (let i = 0; i < chatId.length; i++) {
    h = (Math.imul(31, h) + chatId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function bindSwClickRelay(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (ev) => {
    if (ev.data?.type === "notification-click" && ev.data.chatId) {
      void openNotificationTarget(String(ev.data.chatId));
    }
  });
}

async function initServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register("/notification-sw.js", {
      scope: "/",
    });
    await navigator.serviceWorker.ready;
    bindSwClickRelay();
    console.log("[Notify] ✅ Service Worker ro'yxatdan o'tdi");
  } catch (e) {
    console.warn("[Notify] ⚠ Service Worker xatoligi:", e);
  }
}

async function bindTauriNotificationActions(): Promise<void> {
  if (!isTauri || tauriActionBound) return;
  try {
    const { onAction } = await import("@tauri-apps/plugin-notification");
    await onAction((n) => {
      const chatId = n.extra?.chatId;
      if (typeof chatId === "string" && chatId) {
        void openNotificationTarget(chatId);
      }
    });
    tauriActionBound = true;
  } catch (e) {
    console.warn("[Notify] ⚠ Tauri onAction:", e);
  }
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
      await bindTauriNotificationActions();
      console.log(`[Notify] ✅ Tauri ruxsat: ${granted ? "berildi" : "rad etildi"}`);
    } catch (e) {
      console.warn("[Notify] ⚠ initNotifications xatoligi:", e);
      permGranted = false;
    }
    return;
  }

  await initServiceWorker();

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

function attachBrowserClickHandler(n: Notification, chatId: string): void {
  n.onclick = (ev) => {
    ev.preventDefault();
    n.close();
    activeBrowserNotifs.delete(chatId);
    void openNotificationTarget(chatId);
  };
  n.onclose = () => activeBrowserNotifs.delete(chatId);
}

async function showTauriNative(
  title:     string,
  body:      string,
  chatId:    string,
  avatarKey: string,
): Promise<void> {
  const { sendNotification } = await import("@tauri-apps/plugin-notification");
  sendNotification({
    id:         chatNotifId(chatId),
    title,
    body,
    group:      chatId,
    autoCancel: true,
    extra:      { chatId },
    summary:    APP_NAME,
  });
  console.log(`[Notify] 🔔 Tauri toast: chat=${chatId} avatar=${avatarKey.slice(0, 8)}`);
}

async function showBrowserNative(
  title:  string,
  body:   string,
  chatId: string,
  iconKey: string,
): Promise<void> {
  const icon  = avatarIconUrl(iconKey, 128) || appIconUrl;
  const badge = appIconUrl;
  const tag   = chatId;

  const reg = swRegistration ?? (await navigator.serviceWorker?.ready?.catch(() => null));
  if (reg?.active) {
    reg.active.postMessage({
      type: "show",
      title,
      body,
      icon,
      badge,
      tag,
      chatId,
    });
    console.log(`[Notify] 🔔 SW toast: chat=${chatId}`);
    return;
  }

  if (!permGranted || typeof Notification === "undefined") return;

  try {
    activeBrowserNotifs.get(chatId)?.close();
    const n = new Notification(title, {
      body,
      tag,
      icon,
      badge,
      silent: false,
    } as NotificationOptions & { renotify?: boolean });
    activeBrowserNotifs.set(chatId, n);
    attachBrowserClickHandler(n, chatId);
    console.log(`[Notify] 🔔 Brauzer toast: chat=${chatId}`);
  } catch (e) {
    console.warn("[Notify] ⚠ Notification xatoligi:", e);
  }
}

export interface IncomingNotification {
  chatId:    string;
  chatTitle: string;
  preview:   string;
  isGroup?:  boolean;
}

export async function notifyIncomingMessage(
  chatIdOrTitle: string | IncomingNotification,
  previewArg?:   string,
  chatIdArg?:    string,
): Promise<void> {
  let chatId:    string;
  let chatTitle: string;
  let preview:   string;

  if (typeof chatIdOrTitle === "object") {
    chatId    = chatIdOrTitle.chatId;
    chatTitle = chatIdOrTitle.chatTitle;
    preview   = chatIdOrTitle.preview;
  } else {
    chatTitle = chatIdOrTitle;
    preview   = previewArg ?? "";
    chatId    = chatIdArg ?? "";
  }

  if (!chatId || !isReadablePlaintext(preview)) return;
  if (!permGranted) return;

  const title = truncate(chatTitle.trim() || APP_NAME, 64);
  const body  = truncate(preview, 180);
  const iconKey = chatTitle.trim() || chatId;

  if (isTauri) {
    await showTauriNative(title, body, chatId, iconKey);
  } else {
    await showBrowserNative(title, body, chatId, iconKey);
  }
}
