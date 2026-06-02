// Telegram Desktop uslubidagi slide-out panel.
// Profil, mavzu, qo'lda sozlash (rang/shrift/burchak) va chiqish.
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import {
  useTheme,
  FONT_LABELS,
  RADIUS_LABELS,
  type FontChoice,
  type RadiusPreset,
} from "@/contexts/ThemeContext";
import { THEMES } from "@/themes";
import type { ThemeId } from "@/themes";
import s from "./SideDrawer.module.css";

const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

const AVATAR_COLORS = ["#1d4ed8","#0891b2","#059669","#7c3aed","#dc2626","#d97706","#0d9488"];

interface Props {
  open:    boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { icon: "👤", label: "Mening profilim" },
  { icon: "🔖", label: "Saqlangan xabarlar" },
  { icon: "📁", label: "Arxivlangan" },
  { icon: "📱", label: "Qurilmalar" },
];

const PRESET_COLORS = [
  "#00d4ff","#2aabee","#3b82f6","#8b5cf6",
  "#ec4899","#ef4444","#f97316","#10b981",
  "#84cc16","#eab308","#06b6d4","#6366f1",
];

export default function SideDrawer({ open, onClose }: Props) {
  const { username, role, userId, logout } = useAuthStore();
  const {
    theme, mode, custom,
    setTheme, setMode,
    setCustomColor, setCustomFont, setCustomRadius,
    resetCustom,
  } = useTheme();

  const drawerRef  = useRef<HTMLDivElement>(null);
  const [author, setAuthor]         = useState("Valijon Ibroximov tomonidan yaratilgan");
  const [customOpen, setCustomOpen] = useState(false);
  const [pickerColor, setPickerColor] = useState(custom.color ?? "#00d4ff");

  // Mualliflik matnini Rust qatlamidan olish
  useEffect(() => {
    if (isTauri) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<string>("get_author"))
        .then(setAuthor)
        .catch(() => {});
    }
  }, []);

  // ESC tugmasi
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Ochilganda fokus
  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open]);

  const handleLogout = useCallback(async () => {
    onClose();
    await logout();
  }, [onClose, logout]);

  const applyColor = useCallback((hex: string) => {
    setPickerColor(hex);
    setCustomColor(hex);
  }, [setCustomColor]);

  const clearColor = useCallback(() => {
    setPickerColor("#00d4ff");
    setCustomColor(null);
  }, [setCustomColor]);

  const avatarInitial = (username ?? "?").charAt(0).toUpperCase();
  const avatarBg      = AVATAR_COLORS[(userId ?? "a").charCodeAt(0) % AVATAR_COLORS.length]!;
  const hasCustom     = !!(custom.color || custom.font || custom.radius);

  return (
    <>
      {/* Orqa qoplaydigan fon */}
      <div
        className={`${s.overlay} ${open ? s.overlayVisible : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`${s.drawer} ${open ? s.drawerOpen : ""}`}
        role="dialog"
        aria-label="Asosiy menyu"
        aria-modal="true"
        tabIndex={-1}
      >
        {/* ── Profil sarlavhasi ── */}
        <div className={s.profile}>
          <div className={s.profileBg} style={{ background: `linear-gradient(135deg, ${avatarBg}66 0%, transparent 100%)` }} />
          <div className={s.profileAvatar} style={{ background: avatarBg }}>
            {avatarInitial}
          </div>
          <div className={s.profileName}>{username ?? "Foydalanuvchi"}</div>
          <div className={s.profileRole}>
            {role === "admin" ? "Administrator" : "Foydalanuvchi"} · E2EE faol
          </div>
        </div>

        {/* ── Navigatsiya ── */}
        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => (
            <button key={item.label} className={s.navItem} onClick={onClose}>
              <span className={s.navIcon}>{item.icon}</span>
              <span className={s.navLabel}>{item.label}</span>
            </button>
          ))}

          <div className={s.divider} />

          {/* Dark/Light rejim toggle */}
          <div className={s.modeRow}>
            <span className={s.navIcon}>{mode === "dark" ? "🌙" : "☀️"}</span>
            <span className={s.navLabel} style={{ flex: 1 }}>
              {mode === "dark" ? "Qorong'i rejim" : "Yorug' rejim"}
            </span>
            <button
              className={`${s.toggle} ${mode === "dark" ? s.toggleOn : ""}`}
              onClick={() => setMode(mode === "dark" ? "light" : "dark")}
              aria-label="Rejim almashtirish"
              role="switch"
              aria-checked={mode === "dark"}
            >
              <span className={s.toggleKnob} />
            </button>
          </div>
        </nav>

        {/* Scrollable content */}
        <div className={s.scrollBody}>

          {/* ── Mavzu tanlash ── */}
          <section className={s.section}>
            <div className={s.sectionLabel}>Vizual mavzu</div>
            <div className={s.themeGrid}>
              {THEMES.map((td) => (
                <button
                  key={td.id}
                  className={`${s.themeChip} ${theme === td.id ? s.themeChipActive : ""}`}
                  onClick={() => setTheme(td.id as ThemeId)}
                  title={td.label}
                >
                  <span
                    className={s.themeSwatch}
                    style={{ background: td.preview[0], boxShadow: `inset 0 0 0 4px ${td.preview[1]}40` }}
                  >
                    <span className={s.themeAccentDot} style={{ background: td.preview[1] }} />
                  </span>
                  <span className={s.themeChipLabel}>{td.label}</span>
                  {theme === td.id && (
                    <span className={s.themeCheck}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* ── Qo'lda sozlash paneli ── */}
          <section className={s.section}>
            <button
              className={s.customHeader}
              onClick={() => setCustomOpen(v => !v)}
              aria-expanded={customOpen}
            >
              <span className={s.sectionLabel} style={{ margin: 0 }}>
                ✏️ Dizaynni sozlash
                {hasCustom && <span className={s.customBadge}>•</span>}
              </span>
              <svg
                className={`${s.chevron} ${customOpen ? s.chevronOpen : ""}`}
                width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round"/>
              </svg>
            </button>

            {customOpen && (
              <div className={s.customPanel}>

                {/* Asosiy rang */}
                <div className={s.customGroup}>
                  <div className={s.customGroupLabel}>Asosiy rang (Accent)</div>
                  <div className={s.colorRow}>
                    {PRESET_COLORS.map(hex => (
                      <button
                        key={hex}
                        className={`${s.colorDot} ${custom.color === hex ? s.colorDotActive : ""}`}
                        style={{ background: hex }}
                        onClick={() => custom.color === hex ? clearColor() : applyColor(hex)}
                        title={hex}
                        aria-label={`Rang: ${hex}`}
                      />
                    ))}
                    {/* Erkin rang tanlash */}
                    <label className={s.colorPickerLabel} title="Erkin rang tanlash">
                      <input
                        type="color"
                        className={s.colorPickerInput}
                        value={pickerColor}
                        onChange={e => applyColor(e.target.value)}
                      />
                      <span className={s.colorPickerIcon}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                      </span>
                    </label>
                  </div>
                  {custom.color && (
                    <button className={s.resetSmall} onClick={clearColor}>
                      Standart rangga qaytish
                    </button>
                  )}
                </div>

                {/* Interfeys shrifti */}
                <div className={s.customGroup}>
                  <div className={s.customGroupLabel}>Interfeys shrifti</div>
                  <div className={s.fontGrid}>
                    {(Object.keys(FONT_LABELS) as FontChoice[]).map(key => (
                      <button
                        key={key}
                        className={`${s.fontChip} ${custom.font === key ? s.fontChipActive : ""}`}
                        onClick={() => setCustomFont(custom.font === key ? null : key)}
                      >
                        <span className={s.fontPreview} style={{
                          fontFamily: key === "mono" ? "monospace" : key === "segoe" ? "'Segoe UI'" : key,
                        }}>Aa</span>
                        <span className={s.fontLabel}>{FONT_LABELS[key]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Burchak shakli */}
                <div className={s.customGroup}>
                  <div className={s.customGroupLabel}>Burchak shakli</div>
                  <div className={s.radiusRow}>
                    {(Object.keys(RADIUS_LABELS) as RadiusPreset[]).map(preset => (
                      <button
                        key={preset}
                        className={`${s.radiusBtn} ${custom.radius === preset ? s.radiusBtnActive : ""}`}
                        onClick={() => setCustomRadius(custom.radius === preset ? null : preset)}
                      >
                        <span
                          className={s.radiusPreview}
                          style={{
                            borderRadius: preset === "sharp" ? "0" : preset === "medium" ? "8px" : "16px",
                          }}
                        />
                        <span>{RADIUS_LABELS[preset]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hammasini tiklash */}
                {hasCustom && (
                  <button className={s.resetAll} onClick={resetCustom}>
                    ↺ Barcha sozlamalarni tiklash
                  </button>
                )}
              </div>
            )}
          </section>

        </div>

        {/* ── Footer ── */}
        <div className={s.footer}>
          <div className={s.authorBadge}>{author}</div>
          <button className={s.logoutBtn} onClick={handleLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round"/>
            </svg>
            Chiqish
          </button>
        </div>
      </div>
    </>
  );
}
