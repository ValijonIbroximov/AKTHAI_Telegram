// Harbiy autentifikatsiya ekrani.
// Faqat admin tomonidan yaratilgan hisob bilan kirish amalga oshiriladi.
import { useState, FormEvent } from "react";
import { useAuthStore } from "@/store/authStore";
import s from "./LoginPage.module.css";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const { login, loading, error, clearError } = useAuthStore();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
  };

  return (
    <div className={s.root}>
      <div className={s.card}>

        {/* Logo */}
        <div className={s.logo}>
          <div className={s.logoIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5" opacity="0.7"/>
              <path d="M2 12l10 5 10-5" opacity="0.85"/>
            </svg>
          </div>
          <div className={s.logoTitle}>Harbiy Messenjer</div>
          <div className={s.logoSub}>E2E Shifrlangan · Signal Protocol</div>
        </div>

        {/* Xato xabari */}
        {error && (
          <div className={s.error} role="alert">
            <span className={s.errorIcon}>⚠</span>
            <span className={s.errorText}>{error}</span>
            <button type="button" className={s.errorClose} onClick={clearError} aria-label="Yopish">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Forma */}
        <form onSubmit={onSubmit} className={s.form} noValidate>
          <div className={s.field}>
            <label htmlFor="un" className={s.label}>Foydalanuvchi nomi</label>
            <div className={s.inputWrap}>
              <svg className={s.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <input
                id="un"
                type="text"
                className={s.input}
                placeholder="login_nomi"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className={s.field}>
            <label htmlFor="pw" className={s.label}>Parol</label>
            <div className={s.inputWrap}>
              <svg className={s.inputIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <input
                id="pw"
                type={showPass ? "text" : "password"}
                className={s.input}
                placeholder="Parolni kiriting"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
                required
              />
              <button
                type="button"
                className={s.eyeBtn}
                onClick={() => setShowPass(v => !v)}
                tabIndex={-1}
                aria-label={showPass ? "Parolni yashirish" : "Parolni ko'rsatish"}
              >
                {showPass ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={s.btn}
            disabled={loading || !username.trim() || !password}
          >
            {loading ? (
              <span className={s.spinner} />
            ) : (
              "Kirish"
            )}
          </button>
        </form>

        <p className={s.hint}>
          Hisob yaratish taqiqlangan.{" "}
          <span className={s.hintAccent}>Administrator</span>ga murojaat qiling.
        </p>
      </div>
    </div>
  );
}
