// Telegram Desktop uslubidagi to'liq ekran Sozlamalar sahifasi.
// MessageArea o'rnida ko'rsatiladi; ichki navigatsiya bilan bo'limlarga kirish mumkin.
import { useState, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import ChangePasswordModal from "./ChangePasswordModal";
import { hasDevServerHost, resolveDevServerHost, setDevServerHost } from "@/config/devServer";
import { useTheme, FONT_LABELS, RADIUS_LABELS, type FontChoice, type RadiusPreset } from "@/contexts/ThemeContext";
import { THEMES } from "@/themes";
import type { ThemeId } from "@/themes";
import s from "./SettingsPage.module.css";

/* ── Ichki navigatsiya ── */
type Section = null | "account" | "notifications" | "privacy" | "chat" | "language" | "about";

const MAIN_SECTIONS = [
  { id: "account",       icon: "👤", label: "Mening akkauntim",         desc: "Profil, parol" },
  { id: "notifications", icon: "🔔", label: "Bildirishnomalar",          desc: "Ovoz, vibro" },
  { id: "privacy",       icon: "🔒", label: "Maxfiylik va xavfsizlik",   desc: "E2EE, seans" },
  { id: "chat",          icon: "🎨", label: "Chat sozlamalari",          desc: "Mavzu, rang, shrift" },
  { id: "language",      icon: "🌐", label: "Til",                       desc: "O'zbek, Ru, En" },
  { id: "about",         icon: "ℹ️",  label: "Ilova haqida",             desc: "Versiya, mualliflik" },
] as const;

const PRESET_COLORS = [
  "#00d4ff","#2aabee","#3b82f6","#8b5cf6",
  "#ec4899","#ef4444","#f97316","#10b981",
  "#84cc16","#eab308","#06b6d4","#6366f1",
];

interface Props {
  onBack: () => void;
}

export default function SettingsPage({ onBack }: Props) {
  const [section, setSection] = useState<Section>(null);
  const { username, role, userId } = useAuthStore();

  const AVATAR_COLORS = ["#1d4ed8","#0891b2","#059669","#7c3aed","#dc2626","#d97706","#0d9488"];
  const avatarBg      = AVATAR_COLORS[(userId ?? "a").charCodeAt(0) % AVATAR_COLORS.length]!;
  const avatarInitial = (username ?? "?").charAt(0).toUpperCase();

  const goBack = useCallback(() => {
    if (section !== null) setSection(null);
    else onBack();
  }, [section, onBack]);

  return (
    <div className={s.root}>
      {/* ── Yuqori sarlavha ── */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={goBack} aria-label="Orqaga">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h1 className={s.headerTitle}>
          {section === null       ? "Sozlamalar"
            : section === "account"       ? "Mening akkauntim"
            : section === "notifications" ? "Bildirishnomalar"
            : section === "privacy"       ? "Maxfiylik va xavfsizlik"
            : section === "chat"          ? "Chat sozlamalari"
            : section === "language"      ? "Til"
            : "Ilova haqida"}
        </h1>
      </div>

      {/* ── Sahifa tarkibi ── */}
      <div className={s.body}>

        {/* ═══ ASOSIY RO'YXAT ═══ */}
        {section === null && (
          <>
            {/* Profil bloki */}
            <div className={s.profileCard}>
              <div className={s.profileAvatar} style={{ background: avatarBg }}>
                {avatarInitial}
              </div>
              <div className={s.profileInfo}>
                <div className={s.profileName}>{username ?? "Foydalanuvchi"}</div>
                <div className={s.profileStatus}>
                  <span className={s.onlineDot} />
                  {role === "admin" ? "Administrator" : "Foydalanuvchi"} · onlayn
                </div>
              </div>
              <button className={s.profileEditBtn} aria-label="Profilni tahrirlash" title="Tahrirlash">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>

            {/* Bo'limlar ro'yxati */}
            <div className={s.sectionList}>
              {MAIN_SECTIONS.map(sec => (
                <button
                  key={sec.id}
                  className={s.sectionRow}
                  onClick={() => setSection(sec.id as Section)}
                >
                  <span className={s.sectionIcon}>{sec.icon}</span>
                  <span className={s.sectionText}>
                    <span className={s.sectionLabel}>{sec.label}</span>
                    <span className={s.sectionDesc}>{sec.desc}</span>
                  </span>
                  <svg className={s.sectionChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round"/>
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ═══ CHAT SOZLAMALARI ═══ */}
        {section === "chat" && <ChatSettingsSection />}

        {/* ═══ ILOVA HAQIDA ═══ */}
        {section === "about" && <AboutSection />}

        {/* ═══ PLACEHOLDER BO'LIMLAR ═══ */}
        {section === "privacy" && <PrivacySection />}

        {(section === "account" || section === "notifications" || section === "language") && (
          <PlaceholderSection label={MAIN_SECTIONS.find(s => s.id === section)?.label ?? ""} />
        )}

      </div>
    </div>
  );
}

/* ─── Chat Sozlamalari bo'limi ─────────────────────────────── */
function ChatSettingsSection() {
  const { theme, mode, custom, setTheme, setMode, setCustomColor, setCustomFont, setCustomRadius, resetCustom } = useTheme();
  const [pickerColor, setPickerColor] = useState(custom.color ?? "#00d4ff");

  const applyColor = (hex: string) => { setPickerColor(hex); setCustomColor(hex); };
  const clearColor = () => { setPickerColor("#00d4ff"); setCustomColor(null); };
  const hasCustom  = !!(custom.color || custom.font || custom.radius);

  return (
    <div className={s.chatSettings}>

      {/* Dark/Light rejim */}
      <div className={s.groupBox}>
        <div className={s.groupTitle}>Ekran rejimi</div>
        <div className={s.modeToggleRow}>
          <button
            className={`${s.modeBtn} ${mode === "light" ? s.modeBtnActive : ""}`}
            onClick={() => setMode("light")}
          >
            ☀️ Yorug'
          </button>
          <button
            className={`${s.modeBtn} ${mode === "dark" ? s.modeBtnActive : ""}`}
            onClick={() => setMode("dark")}
          >
            🌙 Qorong'i
          </button>
        </div>
      </div>

      {/* Mavzu tanlash */}
      <div className={s.groupBox}>
        <div className={s.groupTitle}>Vizual mavzu</div>
        <div className={s.themeGrid}>
          {THEMES.map(td => (
            <button
              key={td.id}
              className={`${s.themeCard} ${theme === td.id ? s.themeCardActive : ""}`}
              onClick={() => setTheme(td.id as ThemeId)}
            >
              {/* Mini preview */}
              <div className={s.themePreview} style={{ background: td.preview[0] }}>
                <div className={s.themePreviewSidebar} style={{ background: `${td.preview[0]}cc` }} />
                <div className={s.themePreviewBubble} style={{ background: td.preview[1] }} />
              </div>
              <span className={s.themeCardLabel}>{td.label}</span>
              {theme === td.id && (
                <span className={s.themeCardCheck}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Asosiy rang */}
      <div className={s.groupBox}>
        <div className={s.groupTitle}>Asosiy rang (Accent Color)</div>
        <div className={s.colorGrid}>
          {PRESET_COLORS.map(hex => (
            <button
              key={hex}
              className={`${s.colorSwatch} ${custom.color === hex ? s.colorSwatchActive : ""}`}
              style={{ background: hex }}
              onClick={() => custom.color === hex ? clearColor() : applyColor(hex)}
              title={hex}
            />
          ))}
          <label className={s.colorPickerWrap} title="Erkin rang tanlash">
            <input
              type="color"
              className={s.colorPickerHidden}
              value={pickerColor}
              onChange={e => applyColor(e.target.value)}
            />
            <span className={s.colorPickerIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="13.5" cy="6.5" r="2.5"/>
                <path d="M17 17c0 2.21-1.79 4-4 4s-4-1.79-4-4c0-4.5 4-9 4-9s4 4.5 4 9z"/>
                <path d="M6.5 10.5C5.12 10.5 4 11.62 4 13s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z"/>
              </svg>
              Erkin
            </span>
          </label>
        </div>
        {custom.color && (
          <button className={s.resetLink} onClick={clearColor}>Standart rangga qaytish</button>
        )}
      </div>

      {/* Interfeys shrifti */}
      <div className={s.groupBox}>
        <div className={s.groupTitle}>Interfeys shrifti</div>
        <div className={s.fontGrid}>
          {(Object.keys(FONT_LABELS) as FontChoice[]).map(key => (
            <button
              key={key}
              className={`${s.fontCard} ${custom.font === key ? s.fontCardActive : ""}`}
              onClick={() => setCustomFont(custom.font === key ? null : key)}
            >
              <span className={s.fontSample} style={{
                fontFamily: key === "mono" ? "monospace"
                  : key === "segoe" ? "'Segoe UI'"
                  : key,
              }}>Aa</span>
              <span className={s.fontCardLabel}>{FONT_LABELS[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Burchak shakli */}
      <div className={s.groupBox}>
        <div className={s.groupTitle}>Burchak shakli</div>
        <div className={s.radiusRow}>
          {(Object.keys(RADIUS_LABELS) as RadiusPreset[]).map(preset => (
            <button
              key={preset}
              className={`${s.radiusCard} ${custom.radius === preset ? s.radiusCardActive : ""}`}
              onClick={() => setCustomRadius(custom.radius === preset ? null : preset)}
            >
              <span
                className={s.radiusDemo}
                style={{
                  borderRadius: preset === "sharp" ? "0"
                    : preset === "medium" ? "8px" : "18px",
                  borderColor: custom.radius === preset ? "var(--accent)" : "var(--border)",
                }}
              />
              <span className={s.radiusLabel}>{RADIUS_LABELS[preset]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tiklash */}
      {hasCustom && (
        <button className={s.resetAll} onClick={resetCustom}>
          ↺ Barcha qo'lda sozlamalarni tiklash
        </button>
      )}
    </div>
  );
}

/* ─── Ilova haqida ─────────────────────────────────────────── */
function AboutSection() {
  return (
    <div className={s.aboutSection}>
      <div className={s.aboutLogo}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5" opacity="0.7"/>
          <path d="M2 12l10 5 10-5" opacity="0.85"/>
        </svg>
      </div>
      <h2 className={s.aboutTitle}>Harbiy Messenjer</h2>
      <p className={s.aboutVersion}>v0.1.0 · E2EE · Signal Protocol</p>

      <div className={s.aboutRows}>
        <div className={s.aboutRow}>
          <span className={s.aboutRowLabel}>Shifrlash</span>
          <span className={s.aboutRowValue}>X3DH + Double Ratchet · AES-256-GCM</span>
        </div>
        <div className={s.aboutRow}>
          <span className={s.aboutRowLabel}>Parol hashing</span>
          <span className={s.aboutRowValue}>Argon2id</span>
        </div>
        <div className={s.aboutRow}>
          <span className={s.aboutRowLabel}>Xavfsizlik darajasi</span>
          <span className={s.aboutRowValue}>SEC-LVL-3 · TLS 1.3</span>
        </div>
        <div className={s.aboutRow}>
          <span className={s.aboutRowLabel}>Platforma</span>
          <span className={s.aboutRowValue}>Tauri 2 · Rust · React 19</span>
        </div>
      </div>

      <div className={s.authorBlock}>
        <div className={s.authorIcon}>©</div>
        <p className={s.authorText}>Valijon Ibroximov tomonidan yaratilgan</p>
        <p className={s.authorSub}>Yopiq tarmoq uchun mo'ljallangan. Barcha huquqlar himoyalangan.</p>
      </div>
    </div>
  );
}

/* ─── Maxfiylik va xavfsizlik ──────────────────────────────── */
function PrivacySection() {
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pin, setPin]         = useState("");
  const [pinMsg, setPinMsg]   = useState<string | null>(null);
  const [serverIp, setServerIp] = useState(() => {
    const h = resolveDevServerHost();
    return h === "127.0.0.1" ? "" : h;
  });
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const setAccountPin         = useAuthStore((st) => st.setAccountPin);
  const active                = useAuthStore((st) => st.accounts.find((a) => a.userId === st.activeAccountId));
  const isDev                 = import.meta.env.DEV;

  const saveServerIp = () => {
    setServerMsg(null);
    const ip = serverIp.trim();
    if (!ip) {
      setServerMsg("Server IP kiritilmagan");
      return;
    }
    setDevServerHost(ip);
    setServerMsg("Saqlandi — rasm yuborish uchun sahifani yangilang (F5)");
  };

  const savePin = async () => {
    setPinMsg(null);
    try {
      await setAccountPin(pin);
      setPin("");
      setPinMsg("PIN saqlandi — akkaunt almashishda ishlatiladi");
    } catch (e) {
      setPinMsg(e instanceof Error ? e.message : "PIN saqlanmadi");
    }
  };

  return (
    <div className={s.privacySection}>
      <div className={s.groupBox}>
        <div className={s.groupTitle}>Parol</div>
        <p className={s.groupDesc}>Hisob parolini xavfsiz tarzda yangilang (Argon2id)</p>
        <button type="button" className={s.actionRow} onClick={() => setPwdOpen(true)}>
          <span className={s.actionIcon}>🔑</span>
          <span className={s.actionText}>
            <span className={s.actionLabel}>Parolni o'zgartirish</span>
            <span className={s.actionSub}>Eski va yangi parol talab qilinadi</span>
          </span>
          <svg className={s.sectionChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className={s.groupBox}>
        <div className={s.groupTitle}>Tez qulf (PIN)</div>
        <p className={s.groupDesc}>Akkaunt almashishda 4–6 raqamli PIN (ixtiyoriy)</p>
        <div className={s.pinRow}>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            className={s.pinInput}
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button type="button" className={s.pinSaveBtn} onClick={savePin} disabled={pin.length < 4}>
            Saqlash
          </button>
        </div>
        {active?.pinHash && <p className={s.pinOk}>✓ PIN o'rnatilgan</p>}
        {pinMsg && <p className={s.pinMsg}>{pinMsg}</p>}
      </div>

      {isDev && (
        <div className={s.groupBox}>
          <div className={s.groupTitle}>Server IP (LAN dev)</div>
          <p className={s.groupDesc}>
            Server boshqa mashinada bo&apos;lsa kiriting. Hozir:{" "}
            {hasDevServerHost() ? resolveDevServerHost() : "localhost (proxy)"}
          </p>
          <div className={s.pinRow}>
            <input
              type="text"
              className={s.pinInput}
              placeholder="192.168.101.32"
              value={serverIp}
              onChange={(e) => setServerIp(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className={s.pinSaveBtn} onClick={saveServerIp}>
              Saqlash
            </button>
          </div>
          {serverMsg && <p className={s.pinMsg}>{serverMsg}</p>}
        </div>
      )}

      <div className={s.groupBox}>
        <div className={s.groupTitle}>E2EE</div>
        <p className={s.groupDesc}>
          Barcha xabarlar Signal Protocol (X3DH + Double Ratchet) bilan shifrlanadi.
          Kalitlar faqat qurilmangizda saqlanadi.
        </p>
      </div>

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}

/* ─── Placeholder bo'lim ───────────────────────────────────── */
function PlaceholderSection({ label }: { label: string }) {
  return (
    <div className={s.placeholder}>
      <div className={s.placeholderIcon}>🚧</div>
      <p className={s.placeholderTitle}>{label}</p>
      <p className={s.placeholderDesc}>Bu bo'lim hozirda ishlab chiqilmoqda.</p>
    </div>
  );
}
