// Sozlamalar modali: mavzu tanlash + dastur haqida (mualliflik).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "@/contexts/ThemeContext";
import { THEMES, type ThemeId, type ThemeMode } from "@/themes";
import s from "./SettingsModal.module.css";

interface Props {
  onClose: () => void;
}

const isTauri = typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

export default function SettingsModal({ onClose }: Props) {
  const { theme, mode, setTheme, setMode } = useTheme();
  const [author, setAuthor] = useState<string>("...");

  // Mualliflik yozuvi Rust qatlamidan olinadi (xavfsiz attestatsiya)
  useEffect(() => {
    if (isTauri) {
      invoke<string>("get_author").then(setAuthor).catch(() => {
        setAuthor("Yaxlitlik xatosi");
      });
    } else {
      setAuthor("Valijon Ibroximov tomonidan yaratilgan");
    }
  }, []);

  // Backdrop bosish modalni yopadi
  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={s.backdrop} onClick={onBackdrop} role="dialog" aria-modal="true">
      <div className={s.modal}>

        {/* Sarlavha */}
        <div className={s.header}>
          <span className={s.title}>SOZLAMALAR</span>
          <button className={s.close} onClick={onClose} aria-label="Yopish">✕</button>
        </div>

        {/* Mavzu tanlash */}
        <section className={s.section}>
          <div className={s.sectionLabel}>VIZUAL MAVZU</div>

          {/* Yorug'lik rejimi toggle */}
          <div className={s.modeRow}>
            {(["dark", "light"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                className={`${s.modeBtn} ${mode === m ? s.modeBtnActive : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "dark" ? "◑ Qorong'i" : "○ Yorug'"}
              </button>
            ))}
          </div>

          {/* Mavzu kartochkalari */}
          <div className={s.themeGrid}>
            {THEMES.map((td) => (
              <button
                key={td.id}
                className={`${s.themeCard} ${theme === td.id ? s.themeCardActive : ""}`}
                onClick={() => setTheme(td.id as ThemeId)}
                title={td.label}
              >
                <span
                  className={s.themeSwatch}
                  style={{ background: td.preview[0] }}
                >
                  <span
                    className={s.themeAccent}
                    style={{ background: td.preview[1] }}
                  />
                </span>
                <span className={s.themeLabel}>{td.label}</span>
                {theme === td.id && <span className={s.themeCheck}>✓</span>}
              </button>
            ))}
          </div>
        </section>

        {/* Dastur haqida */}
        <section className={s.section}>
          <div className={s.sectionLabel}>DASTUR HAQIDA</div>
          <div className={s.about}>
            <div className={s.aboutLogo}>▲</div>
            <div className={s.aboutName}>Harbiy Messenjer</div>
            <div className={s.aboutVer}>v0.1.0 · E2EE · Signal Protocol</div>
            <div className={s.aboutAuthor}>{author}</div>
            <div className={s.aboutTech}>
              Tauri 2 · React 19 · Go 1.26 · Rust · PostgreSQL
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
