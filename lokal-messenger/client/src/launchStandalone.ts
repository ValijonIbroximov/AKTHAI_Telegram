// LAN (192.168.x.x) orqali kirilganda brauzer tab o'rniga alohida oyna + fullscreen.
const POPUP_NAME = "HarbiyMessenjer";

function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";
}

function isLanHost(): boolean {
  const h = window.location.hostname;
  return h !== "localhost" && h !== "127.0.0.1" && h !== "";
}

function isPopupSession(): boolean {
  const p = new URLSearchParams(window.location.search);
  return p.get("popup") === "1" || !!window.opener;
}

function popupFeatures(): string {
  const w = window.screen?.availWidth ?? 1280;
  const h = window.screen?.availHeight ?? 800;
  return [
    "popup=yes",
    `width=${w}`,
    `height=${h}`,
    "left=0",
    "top=0",
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "resizable=yes",
  ].join(",");
}

function tryFullscreen(): void {
  if (document.fullscreenElement) return;
  void document.documentElement.requestFullscreen().catch(() => {});
}

function cleanAutostartParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("autostart")) return;
  url.searchParams.delete("autostart");
  window.history.replaceState({}, "", url);
}

/** main.tsx dan React render oldin chaqiriladi */
export function launchStandaloneIfNeeded(): void {
  if (isTauri() || !isLanHost()) return;

  if (isPopupSession()) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "1") {
      const run = () => {
        tryFullscreen();
        cleanAutostartParam();
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run, { once: true });
      } else {
        run();
      }
      document.addEventListener(
        "click",
        () => tryFullscreen(),
        { once: true, capture: true },
      );
    }
    return;
  }

  if (sessionStorage.getItem("harbiy_popup_redirect") === "1") return;
  sessionStorage.setItem("harbiy_popup_redirect", "1");

  const url = new URL(window.location.href);
  url.searchParams.set("popup", "1");
  url.searchParams.set("autostart", "1");

  const popup = window.open(url.toString(), POPUP_NAME, popupFeatures());
  if (popup) {
    popup.focus();
    window.close();
  } else {
    sessionStorage.removeItem("harbiy_popup_redirect");
  }
}
