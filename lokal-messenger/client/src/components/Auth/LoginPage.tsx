// Kirish sahifasi — faqat admin yaratgan hisob bilan kirish mumkin.
// Telegram Desktop Login uslubi aks ettirilgan.
import { useState, FormEvent } from "react";
import { useAuthStore } from "@/store/authStore";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, loading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
  };

  return (
    <div className={styles.root}>
      {/* Orqa fon tarmog'i */}
      <div className={styles.bg} aria-hidden />

      <div className={styles.card}>
        {/* Gerb / Logo */}
        <div className={styles.logo}>
          <svg viewBox="0 0 48 48" fill="none" aria-label="Harbiy Messenjer">
            <circle cx="24" cy="24" r="22" fill="var(--accent)" opacity=".15" />
            <circle cx="24" cy="24" r="18" fill="var(--accent)" opacity=".12" />
            <path
              d="M24 10 L28 20 L39 20 L30 27 L33 38 L24 31 L15 38 L18 27 L9 20 L20 20 Z"
              fill="var(--accent)"
              opacity=".9"
            />
          </svg>
        </div>

        <h1 className={styles.title}>Harbiy Messenjer</h1>
        <p className={styles.subtitle}>Yopiq tarmoq — faqat vakolatli foydalanuvchilar</p>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>⚠</span>
              <span>{error}</span>
              <button
                type="button"
                className={styles.errorClose}
                onClick={clearError}
                aria-label="Xatoni yopish"
              >✕</button>
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="username" className={styles.label}>
              Foydalanuvchi nomi
            </label>
            <input
              id="username"
              type="text"
              className={styles.input}
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>
              Parol
            </label>
            <input
              id="password"
              type="password"
              className={styles.input}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading || !username.trim() || !password}
          >
            {loading ? (
              <span className={styles.spinner} aria-hidden />
            ) : (
              "Kirish"
            )}
          </button>
        </form>

        <p className={styles.hint}>
          Hisob mavjud bo'lmasa, tizim administratoriga murojaat qiling.
        </p>
      </div>
    </div>
  );
}
