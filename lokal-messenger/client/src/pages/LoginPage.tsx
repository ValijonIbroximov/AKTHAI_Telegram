// Fayl: client/src/pages/LoginPage.tsx
// Maqsad: Faqat hisob ma'lumotlari orqali kirish — ochiq ro'yxatdan o'tish yo'q.
import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../stores/auth";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSession } = useAuthStore();

  // Kirish jarayoni: Rust orqali server bilan aloqa o'rnatiladi
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Login chaqiriladi (Rust orqali server bilan aloqa)
      const res = await invoke<{
        token: string;
        user_id: string;
        role: string;
        must_change_password: boolean;
      }>("login", { username, password });

      setSession({
        token: res.token,
        userId: res.user_id,
        role: res.role,
        mustChange: res.must_change_password,
      });

      // Birinchi kirishda kalitlar yaratiladi va serverga yuklanadi
      await invoke("bootstrap_keys");
    } catch (err: any) {
      setError(typeof err === "string" ? err : "kirish xatosi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Lokal Messenger</h1>
        <p className="subtitle">Yopiq tarmoq messenjeri</p>

        <label>Login</label>
        <input
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <label>Parol</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="error-line">{error}</div>}

        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Tekshirilyapti..." : "Tizimga kirish"}
        </button>

        <div className="hint">Hisob faqat administrator tomonidan beriladi.</div>
      </form>
    </div>
  );
}
