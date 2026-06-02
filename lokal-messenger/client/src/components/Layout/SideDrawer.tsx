// Telegram Desktop uslubidagi slide-out panel.
// Chap tomondan silliq siljib chiqadi (hamburger menyudan ochiladi).
import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/store/authStore";
import { useTheme }     from "@/contexts/ThemeContext";
import { THEMES }       from "@/themes";
import type { ThemeId } from "@/themes";
import s from "./SideDrawer.module.css";

const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

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

export default function SideDrawer({ open, onClose }: Props) {
  const { username, role, userId, logout } = useAuthStore();
  const { theme, mode, setTheme, setMode } = useTheme();
  const drawerRef = useRef<HTMLDivElement>(null);
  const [author, setAuthor] = useState("Valijon Ibroximov tomonidan yaratilgan");

  // Mualliflik matnini Rust qatlamidan olish (Poison Pill bilan bog'liq)
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
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Ochilganda fokus berish
  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open]);

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  const avatarInitial = (username ?? "?").charAt(0).toUpperCase();
  const AVATAR_COLORS = ["#1d4ed8","#0891b2","#059669","#7c3aed","#dc2626","#d97706"];
  const avatarBg      = AVATAR_COLORS[(userId ?? "a").charCodeAt(0) % AVATAR_COLORS.length]!;

  return (
    <>
      {/* Qorong'i orqa fon (bosib yopish) */}
      <div
        className={`${s.overlay} ${open ? s.overlayVisible : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer paneli */}
      <div
        ref={drawerRef}
        className={`${s.drawer} ${open ? s.drawerOpen : ""}`}
        role="dialog"
        aria-label="Asosiy menyu"
        aria-modal="true"
        tabIndex={-1}
      >
        {/* Profil sarlavhasi */}
        <div className={s.profile}>
          <div className={s.profileBg} />
          <div className={s.profileAvatar} style={{ background: avatarBg }}>
            {avatarInitial}
          </div>
          <div className={s.profileName}>{username ?? "Foydalanuvchi"}</div>
          <div className={s.profileRole}>
            {role === "admin" ? "Administrator" : "Foydalanuvchi"} · E2EE faol
          </div>
        </div>

        {/* Navigatsiya elementlari */}
        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => (
            <button key={item.label} className={s.navItem} onClick={onClose}>
              <span className={s.navIcon}>{item.icon}</span>
              <span className={s.navLabel}>{item.label}</span>
            </button>
          ))}

          <div className={s.separator} />

          {/* Qorong'i/Yorug' rejim toggle */}
          <div className={s.modeRow}>
            <span className={s.navIcon}>{mode === "dark" ? "🌙" : "☀️"}</span>
            <span className={s.navLabel} style={{ flex: 1 }}>
              {mode === "dark" ? "Qorong'i rejim" : "Yorug' rejim"}
            </span>
            <button
              className={`${s.modeToggle} ${mode === "dark" ? s.modeToggleOn : ""}`}
              onClick={() => setMode(mode === "dark" ? "light" : "dark")}
              aria-label="Rejim almashtirish"
              role="switch"
              aria-checked={mode === "dark"}
            >
              <span className={s.modeKnob} />
            </button>
          </div>
        </nav>

        {/* Mavzu tanlash */}
        <div className={s.themeSection}>
          <div className={s.themeSectionLabel}>Vizual mavzu</div>
          <div className={s.themeGrid}>
            {THEMES.map((td) => (
              <button
                key={td.id}
                className={`${s.themeChip} ${theme === td.id ? s.themeChipActive : ""}`}
                onClick={() => setTheme(td.id as ThemeId)}
                title={td.label}
              >
                <span
                  className={s.themeChipSwatch}
                  style={{
                    background: td.preview[0],
                    borderColor: td.preview[1],
                  }}
                >
                  <span
                    className={s.themeChipAccent}
                    style={{ background: td.preview[1] }}
                  />
                </span>
                <span className={s.themeChipLabel}>{td.label}</span>
                {theme === td.id && (
                  <span className={s.themeChipCheck}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Footer: mualliflik + chiqish */}
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
