// Telegram Desktop uslubidagi slide-out navigatsiya paneli.
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

function avatarColor(userId: string): string {
  return AVATAR_COLORS[userId.charCodeAt(0) % AVATAR_COLORS.length]!;
}

export default function SideDrawer({ open, onClose, onSettings }: Props) {
  const {
    username, role, userId, activeAccountId, accounts,
    logout, beginAddAccount, beginSwitchAccount,
  } = useAuthStore();
  const { mode, setMode } = useTheme();
  const drawerRef = useRef<HTMLDivElement>(null);
  const [author, setAuthor] = useState("Valijon Ibroximov tomonidan yaratilgan");

  useEffect(() => {
    if (isTauri) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<string>("get_author"))
        .then(setAuthor)
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

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

  const handleAddAccount = useCallback(() => {
    onClose();
    beginAddAccount();
  }, [onClose, beginAddAccount]);

  const handleSwitch = useCallback((uid: string) => {
    onClose();
    if (uid === activeAccountId) return;
    beginSwitchAccount(uid);
  }, [onClose, activeAccountId, beginSwitchAccount]);

  const avatarInitial = (username ?? "?").charAt(0).toUpperCase();
  const avatarBg      = avatarColor(userId ?? "a");

  return (
    <>
      <div
        className={`${s.overlay} ${open ? s.overlayVisible : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        className={`${s.drawer} ${open ? s.drawerOpen : ""}`}
        role="dialog"
        aria-label="Asosiy menyu"
        aria-modal="true"
        tabIndex={-1}
      >
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

        {/* ── Akkauntlar (Telegram uslubi) ── */}
        <div className={s.accounts}>
          <div className={s.accountsTitle}>Akkauntlar</div>
          <div className={s.accountList}>
            {accounts.map((acc) => {
              const bg = avatarColor(acc.userId);
              const active = acc.userId === activeAccountId;
              return (
                <button
                  key={acc.userId}
                  type="button"
                  className={`${s.accountItem} ${active ? s.accountItemActive : ""}`}
                  onClick={() => handleSwitch(acc.userId)}
                >
                  <span className={s.accountAvatar} style={{ background: bg }}>
                    {acc.username.charAt(0).toUpperCase()}
                  </span>
                  <span className={s.accountName}>{acc.username}</span>
                  {active && <span className={s.accountCheck}>✓</span>}
                </button>
              );
            })}
            <button type="button" className={s.addAccountBtn} onClick={handleAddAccount}>
              <span className={s.addAccountIcon}>+</span>
              <span>Akkaunt qo'shish</span>
            </button>
          </div>
        </div>

        <nav className={s.nav}>
          {NAV_ITEMS.map(item => (
            <button key={item.label} className={s.navItem} onClick={onClose}>
              <span className={s.navIcon}>{item.icon}</span>
              <span className={s.navLabel}>{item.label}</span>
            </button>
          ))}

          <div className={s.divider} />

          <button className={s.navItem} onClick={handleSettings}>
            <span className={s.navIcon}>⚙️</span>
            <span className={s.navLabel}>Sozlamalar</span>
          </button>

          <div className={s.divider} />

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
