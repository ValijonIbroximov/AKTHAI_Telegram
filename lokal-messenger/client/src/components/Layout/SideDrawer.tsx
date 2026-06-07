// Telegram Desktop uslubidagi slide-out navigatsiya paneli.
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import { useTheme }     from "@/contexts/ThemeContext";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import s from "./SideDrawer.module.css";

const isTauri =
  typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";

interface Props {
  open:       boolean;
  onClose:    () => void;
  onSettings: () => void;
  onAdmin?:   () => void;
}

const AVATAR_COLORS = [
  "#1d4ed8","#0891b2","#059669",
  "#7c3aed","#dc2626","#d97706","#0d9488",
];

function avatarColor(userId: string): string {
  return AVATAR_COLORS[userId.charCodeAt(0) % AVATAR_COLORS.length]!;
}

interface NavItem {
  icon:    React.ReactNode;
  label:   string;
  onClick: () => void;
  danger?: boolean;
}

export default function SideDrawer({ open, onClose, onSettings, onAdmin }: Props) {
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

  useRegisterBackHandler(
    useCallback(() => {
      if (!open) return false;
      onClose();
      return true;
    }, [open, onClose]),
    open,
    BACK_PRIORITY.sideDrawer,
  );

  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open]);

  const handleSettings = useCallback(() => { onClose(); onSettings(); }, [onClose, onSettings]);
  const handleAdmin    = useCallback(() => { onClose(); onAdmin?.(); }, [onClose, onAdmin]);
  const handleLogout   = useCallback(async () => { onClose(); await logout(); }, [onClose, logout]);
  const handleAddAccount = useCallback(() => { onClose(); beginAddAccount(); }, [onClose, beginAddAccount]);
  const handleSwitch   = useCallback((uid: string) => {
    onClose();
    if (uid !== activeAccountId) beginSwitchAccount(uid);
  }, [onClose, activeAccountId, beginSwitchAccount]);

  const avatarInitial = (username ?? "?").charAt(0).toUpperCase();
  const avatarBg      = avatarColor(userId ?? "a");

  const NAV_ITEMS: NavItem[] = [
    {
      label: "Yangi Guruh",
      onClick: onClose,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: "Yangi Kanal",
      onClick: onClose,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M22 16.92v3a2 2 0 01-2.18 2A19.79 19.79 0 0112 18.43a19.5 19.5 0 01-5-5 19.79 19.79 0 01-3.49-7.84 2 2 0 011.99-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L9.09 11a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0122 16.92z" strokeLinecap="round"/>
          <path d="M14.5 2C16.4 2.8 18 4.4 18.5 6.5M14.5 6c1 .5 1.8 1.3 2 2.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: "Kontaktlar",
      onClick: onClose,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      ),
    },
    {
      label: "Saqlangan xabarlar",
      onClick: onClose,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      label: "Sozlamalar",
      onClick: handleSettings,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

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
        {/* ── Profil bloki ── */}
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

        {/* ── Akkauntlar ── */}
        <div className={s.accounts}>
          <div className={s.accountsTitle}>Akkauntlar</div>
          <div className={s.accountList}>
            {accounts.map((acc) => {
              const bg     = avatarColor(acc.userId);
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

        {/* ── Asosiy navigatsiya ── */}
        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={s.navItem}
              onClick={item.onClick}
            >
              <span className={s.navIcon}>{item.icon}</span>
              <span className={s.navLabel}>{item.label}</span>
            </button>
          ))}

          {role === "admin" && (
            <button type="button" className={s.navItem} onClick={handleAdmin}>
              <span className={s.navIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className={s.navLabel}>Admin Panel</span>
            </button>
          )}

          <div className={s.divider} />

          {/* Tungi rejim toggle */}
          <div className={s.modeRow}>
            <span className={s.navIcon}>
              {mode === "dark" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="5"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round"/>
                </svg>
              )}
            </span>
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
