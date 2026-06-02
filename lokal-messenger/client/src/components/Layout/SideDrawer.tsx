// Telegram Desktop uslubidagi slide-out navigatsiya paneli.
// Sozlamalar ilovaning alohida sahifasiga yo'naltiradi (SideDrawer ichida emas).
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import { useTheme }     from "@/contexts/ThemeContext";
import s from "./SideDrawer.module.css";

const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

interface Props {
  open:        boolean;
  onClose:     () => void;
  onSettings:  () => void;
}

const NAV_ITEMS = [
  { icon: "🔖", label: "Saqlangan xabarlar" },
  { icon: "📁", label: "Arxivlangan suhbatlar" },
  { icon: "📱", label: "Qurilmalar" },
  { icon: "📞", label: "Qo'ng'iroqlar" },
];

const AVATAR_COLORS = [
  "#1d4ed8","#0891b2","#059669",
  "#7c3aed","#dc2626","#d97706","#0d9488",
];

export default function SideDrawer({ open, onClose, onSettings }: Props) {
  const { username, role, userId, logout } = useAuthStore();
  const { mode, setMode } = useTheme();
  const drawerRef = useRef<HTMLDivElement>(null);
  const [author, setAuthor] = useState("Valijon Ibroximov tomonidan yaratilgan");

  // Mualliflik matnini Rust qatlamidan olish
  useEffect(() => {
    if (isTauri) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<string>("get_author"))
        .then(setAuthor)
        .catch(() => {});
    }
  }, []);

  // ESC tugmasi bilan yopish
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Ochilganda fokus
  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open]);

  const handleSettings = useCallback(() => {
    onClose();
    onSettings();
  }, [onClose, onSettings]);

  const handleLogout = useCallback(async () => {
    onClose();
    await logout();
  }, [onClose, logout]);

  const avatarInitial = (username ?? "?").charAt(0).toUpperCase();
  const avatarBg      = AVATAR_COLORS[(userId ?? "a").charCodeAt(0) % AVATAR_COLORS.length]!;

  return (
    <>
      {/* Orqa fon */}
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
          <div
            className={s.profileBg}
            style={{ background: `linear-gradient(135deg, ${avatarBg}55 0%, transparent 100%)` }}
          />
          <div className={s.profileAvatar} style={{ background: avatarBg }}>
            {avatarInitial}
          </div>
          <div className={s.profileName}>{username ?? "Foydalanuvchi"}</div>
          <div className={s.profileRole}>
            {role === "admin" ? "Administrator" : "Foydalanuvchi"} · E2EE
          </div>
        </div>

        {/* ── Navigatsiya elementlari ── */}
        <nav className={s.nav}>
          {NAV_ITEMS.map(item => (
            <button key={item.label} className={s.navItem} onClick={onClose}>
              <span className={s.navIcon}>{item.icon}</span>
              <span className={s.navLabel}>{item.label}</span>
            </button>
          ))}

          <div className={s.divider} />

          {/* Sozlamalar — alohida sahifaga o'tish */}
          <button className={s.navItem} onClick={handleSettings}>
            <span className={s.navIcon}>⚙️</span>
            <span className={s.navLabel}>Sozlamalar</span>
          </button>

          <div className={s.divider} />

          {/* Dark/Light toggle */}
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
