// Harbiy Messenjer — universal titlebar.
// Tauri desktop va brauzerda bir xil ko'rinadi.
// Tauri: oyna tugmalari (minimize / maximize / close) to'liq ishlaydi + drag-region.
// Brauzer: tugmalar ko'rinadi, click ishlamaydi (mock), dastur crash bo'lmaydi.
import { useCallback, useEffect, useRef, useState } from "react";
import s from "./TitleBar.module.css";

// ──────────────────────────────────────────────────────────────────────────────
// Tauri oyna API ni bir marta lazy yuklaydi va keshlab qoladi.
// window.__TAURI__ tekshiruviga taylanmaydi (v2 da har xil bo'lishi mumkin).
// Importda xato bo'lsa → brauzer muhiti deb qabul qilinadi.
// ──────────────────────────────────────────────────────────────────────────────
let _tauriWinCache: ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow> | null = null;
let _tauriWinLoading = false;
let _tauriWinCallbacks: Array<(win: typeof _tauriWinCache) => void> = [];

function getTauriWindow(): Promise<typeof _tauriWinCache> {
  if (_tauriWinCache !== null) return Promise.resolve(_tauriWinCache);

  return new Promise((resolve) => {
    _tauriWinCallbacks.push(resolve);

    if (_tauriWinLoading) return;
    _tauriWinLoading = true;

    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        try {
          _tauriWinCache = getCurrentWindow();
        } catch {
          _tauriWinCache = null;
        }
      })
      .catch(() => {
        _tauriWinCache = null;
      })
      .finally(() => {
        const win = _tauriWinCache;
        const cbs = _tauriWinCallbacks.splice(0);
        cbs.forEach((cb) => cb(win));
        _tauriWinLoading = false;
      });
  });
}

// ──────────────────────────────────────────────────────────────────────────────

export default function TitleBar() {
  const [maximized, setMaximized]     = useState(false);
  const [isTauriEnv, setIsTauriEnv]   = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;

    getTauriWindow().then((win) => {
      if (!mounted || !win) return;

      setIsTauriEnv(true);

      win.isMaximized()
        .then((m) => { if (mounted) setMaximized(m); })
        .catch(() => {});

      win.onResized(() => {
        if (!mounted) return;
        win.isMaximized()
          .then((m) => { if (mounted) setMaximized(m); })
          .catch(() => {});
      })
        .then((fn) => { unlistenRef.current = fn; })
        .catch(() => {});
    });

    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
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
      {/* data-tauri-drag-region: faqat bu div orqali oynani sudrab yurish */}
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

      {/* controls: qat'iy no-drag + pointer-events: auto → bosish DOIM ishlaydi */}
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
