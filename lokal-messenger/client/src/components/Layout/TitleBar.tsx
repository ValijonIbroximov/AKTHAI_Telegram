// Tauri uchun maxsus titlebar — Telegram Desktop uslubida.
// Brauzerda render qilinmaydi (decorations: false faqat desktop).
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@/crypto/adapter";
import s from "./TitleBar.module.css";

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      win.isMaximized().then(setMaximized).catch(() => {});
      const unlisten = win.onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      });
      return () => { void unlisten.then((fn) => fn()); };
    });
  }, []);

  const minimize = useCallback(() => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().minimize()
    );
  }, []);

  const toggleMaximize = useCallback(() => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().toggleMaximize()
    );
  }, []);

  const close = useCallback(() => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().close()
    );
  }, []);

  if (!isTauri) return null;

  return (
    <header className={s.bar}>
      <div className={s.drag} data-tauri-drag-region>
        <span className={s.icon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 12l10 5 10-5" opacity="0.8"/>
          </svg>
        </span>
        <span className={s.title}>Harbiy Messenjer</span>
      </div>

      <div className={s.controls}>
        <button type="button" className={s.ctrl} onClick={minimize} aria-label="Kichraytirish" title="Kichraytirish">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button type="button" className={s.ctrl} onClick={toggleMaximize} aria-label="Kattalashtirish" title={maximized ? "Qayta tiklash" : "Kattalashtirish"}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="0.5" width="7" height="7"/>
              <rect x="0.5" y="2.5" width="7" height="7"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9"/>
            </svg>
          )}
        </button>
        <button type="button" className={`${s.ctrl} ${s.close}`} onClick={close} aria-label="Yopish" title="Yopish">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1l8 8M9 1L1 9" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </header>
  );
}
