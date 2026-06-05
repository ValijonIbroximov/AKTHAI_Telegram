// Akkaunt almashishda PIN yoki parol so'rash (Telegram uslubi).
import { useState, FormEvent, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import s from "./AccountUnlockModal.module.css";

export default function AccountUnlockModal() {
  const uiMode         = useAuthStore((st) => st.uiMode);
  const unlockTargetId = useAuthStore((st) => st.unlockTargetId);
  const accounts       = useAuthStore((st) => st.accounts);
  const loading        = useAuthStore((st) => st.loading);
  const error          = useAuthStore((st) => st.error);
  const unlockWithPassword = useAuthStore((st) => st.unlockWithPassword);
  const unlockWithPin      = useAuthStore((st) => st.unlockWithPin);
  const cancelAuthUI       = useAuthStore((st) => st.cancelAuthUI);
  const clearError         = useAuthStore((st) => st.clearError);

  const target = accounts.find((a) => a.userId === unlockTargetId);
  const hasPin = !!target?.pinHash;

  const [mode, setMode]       = useState<"pin" | "password">("pin");
  const [pin, setPin]         = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    setMode(hasPin ? "pin" : "password");
    setPin("");
    setPassword("");
    clearError();
  }, [unlockTargetId, hasPin, clearError]);

  if (uiMode !== "switch_unlock" || !target) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "pin") {
      await unlockWithPin(pin);
    } else {
      await unlockWithPassword(password);
    }
  };

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label="Akkaunt qulfi">
      <div className={s.card}>
        <div className={s.avatar}>{target.username.charAt(0).toUpperCase()}</div>
        <h2 className={s.title}>{target.username}</h2>
        <p className={s.sub}>
          {mode === "pin" ? "PIN kodini kiriting" : "Parolni kiriting"}
        </p>

        {error && (
          <div className={s.error} role="alert">{error}</div>
        )}

        <form onSubmit={onSubmit} className={s.form}>
          {mode === "pin" ? (
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              maxLength={6}
              className={s.input}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              disabled={loading}
            />
          ) : (
            <input
              type="password"
              className={s.input}
              placeholder="Parol"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={loading}
              autoComplete="current-password"
            />
          )}

          <button type="submit" className={s.btn} disabled={loading || (mode === "pin" ? pin.length < 4 : !password)}>
            {loading ? "…" : "Davom etish"}
          </button>
        </form>

        {hasPin && (
          <button type="button" className={s.link} onClick={() => { setMode(mode === "pin" ? "password" : "pin"); clearError(); }}>
            {mode === "pin" ? "Parol bilan ochish" : "PIN bilan ochish"}
          </button>
        )}

        <button type="button" className={s.cancel} onClick={cancelAuthUI}>Bekor qilish</button>
      </div>
    </div>
  );
}
