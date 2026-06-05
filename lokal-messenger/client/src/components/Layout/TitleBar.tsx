// Harbiy Messenjer — universal titlebar.
// Tauri desktop va brauzerda bir xil ishlaydi.
// Tauri: oyna tugmalari ishlaydi + drag-region.
// Brauzer: tugmalar ko'rinadi lekin brauzer boshqaruviga aralashmaydi.
import { useCallback, useEffect, useState } from "react";
import s from "./TitleBar.module.css";

/** Tauri oyna API ni lazy yuklaydi. Brauzerda null qaytaradi. */
async function getTauriWindow() {
  try {
    if (typeof window === "undefined" || !(window as Record<string, unknown>).__TAURI__) {
      return null;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [isTauriEnv, setIsTauriEnv] = useState(false);

  useEffect(() => {
    const hasTauri = typeof window !== "undefined" &&
      !!(window as Record<string, unknown>).__TAURI__;
    setIsTauriEnv(hasTauri);

    if (!hasTauri) return;

    let unlisten: (() => void) | null = null;

    getTauriWindow().then((win) => {
      if (!win) return;
      win.isMaximized().then(setMaximized).catch(() => {});
      win.onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      }).then((fn) => {
        unlisten = fn;
      }).catch(() => {});
    });

    return () => { unlisten?.(); };
  }, []);

  const minimize = useCallback(() => {
    getTauriWindow().then((win) => win?.minimize()).catch(() => {});
  }, []);

  const toggleMaximize = useCallback(() => {
    getTauriWindow().then((win) => win?.toggleMaximize()).catch(() => {});
  }, []);

  const close = useCallback(() => {
    getTauriWindow().then((win) => win?.close()).catch(() => {});
  }, []);

  return (
    <header className={s.bar}>
      {/* data-tauri-drag-region: Tauri da oynani sudrab yurishga imkon beradi */}
      <div className={s.drag} data-tauri-drag-region>
        <span className={s.icon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 12l10 5 10-5" opacity="0.8"/>
          </svg>
        </span>
        <span className={s.title}>Harbiy Messenjer</span>
      </div>

      <div className={s.controls}>
        <button
          type="button"
          className={`${s.ctrl} ${!isTauriEnv ? s.ctrlBrowser : ""}`}
          onClick={minimize}
          aria-label="Kichraytirish"
          title="Kichraytirish"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect y="4.5" width="10" height="1" fill="currentColor"/>
          </svg>
        </button>

        <button
          type="button"
          className={`${s.ctrl} ${!isTauriEnv ? s.ctrlBrowser : ""}`}
          onClick={toggleMaximize}
          aria-label={maximized ? "Qayta tiklash" : "Kattalashtirish"}
          title={maximized ? "Qayta tiklash" : "Kattalashtirish"}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                 stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="0.5" width="7" height="7"/>
              <rect x="0.5" y="2.5" width="7" height="7"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                 stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9"/>
            </svg>
          )}
        </button>

        <button
          type="button"
          className={`${s.ctrl} ${s.close} ${!isTauriEnv ? s.ctrlBrowser : ""}`}
          onClick={close}
          aria-label="Yopish"
          title="Yopish"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"
               stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1l8 8M9 1L1 9" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </header>
  );
}
