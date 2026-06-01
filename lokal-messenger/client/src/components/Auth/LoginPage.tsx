// Harbiy autentifikatsiya ekrani — Dark Navy / Cyan uslubi.
// Faqat admin tomonidan yaratilgan hisob bilan kirish amalga oshiriladi.
import { useState, FormEvent } from "react";
import { useAuthStore } from "@/store/authStore";
import s from "./LoginPage.module.css";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, loading, error, clearError } = useAuthStore();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
  };

  return (
    <div className={s.root}>
      <div className={s.card}>

        {/* Status satri */}
        <div className={s.statusBar}>
          <span className={s.statusDot} />
          <span>Yopiq Tarmoq · TLS Aktiv</span>
        </div>

        {/* Logo */}
        <div className={s.logo}>
          <div className={s.logoIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className={s.logoTitle}>Harbiy Messenjer</div>
          <div className={s.logoSub}>E2EE · Signal Protocol · v0.1</div>
        </div>

        {/* Forma */}
        <form onSubmit={onSubmit} className={s.form} noValidate>
          {error && (
            <div className={s.error} role="alert">
              <span>⚠</span>
              <span>{error}</span>
              <button type="button" className={s.errorClose} onClick={clearError}>✕</button>
            </div>
          )}

          <div className={s.field}>
            <label htmlFor="un" className={s.label}>Identifikator</label>
            <div className={s.inputWrap}>
              <span className={s.inputIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <input
                id="un" type="text" className={s.input}
                placeholder="login_nomi"
                value={username} onChange={e => setUsername(e.target.value)}
                autoComplete="username" autoFocus disabled={loading} required
              />
            </div>
          </div>

          <div className={s.field}>
            <label htmlFor="pw" className={s.label}>Parol</label>
            <div className={s.inputWrap}>
              <span className={s.inputIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
              </span>
              <input
                id="pw" type="password" className={s.input}
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" disabled={loading} required
              />
            </div>
          </div>

          <button
            type="submit" className={s.btn}
            disabled={loading || !username.trim() || !password}
          >
            {loading
              ? <span className={s.spinner} />
              : <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                  </svg>
                  Kirish
                </>
            }
          </button>
        </form>

        <p className={s.hint}>
          Hisob yaratish taqiqlangan.{" "}
          <span className={s.hintHighlight}>Administrator</span>ga murojaat qiling.
        </p>
        <p className={s.versionTag}>SYS · SEC-LVL-3 · AES-256-GCM · ARGON2ID</p>
      </div>
    </div>
  );
}
