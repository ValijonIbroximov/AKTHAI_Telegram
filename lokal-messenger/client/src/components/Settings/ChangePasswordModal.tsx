// Parolni o'zgartirish modali — Maxfiylik va xavfsizlik bo'limi.
import { useState, FormEvent } from "react";
import { useAuthStore } from "@/store/authStore";
import s from "./ChangePasswordModal.module.css";

interface Props {
  open:    boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ open, onClose }: Props) {
  const changePassword = useAuthStore((st) => st.changePassword);
  const [oldPwd, setOldPwd]       = useState("");
  const [newPwd, setNewPwd]       = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  if (!open) return null;

  const reset = () => {
    setOldPwd("");
    setNewPwd("");
    setConfirm("");
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPwd.length < 8) {
      setError("Yangi parol kamida 8 belgidan iborat bo'lishi kerak");
      return;
    }
    if (newPwd !== confirm) {
      setError("Yangi parollar mos kelmaydi");
      return;
    }
    setLoading(true);
    try {
      await changePassword(oldPwd, newPwd);
      setSuccess(true);
      setTimeout(handleClose, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parol o'zgartirilmadi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={s.overlay} onClick={handleClose} role="presentation">
      <div className={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={s.header}>
          <h2 className={s.title}>Parolni o'zgartirish</h2>
          <button type="button" className={s.closeBtn} onClick={handleClose} aria-label="Yopish">×</button>
        </div>

        {success ? (
          <div className={s.success}>
            <span className={s.successIcon}>✓</span>
            <p>Parol muvaffaqiyatli yangilandi</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className={s.form}>
            {error && <div className={s.error} role="alert">{error}</div>}

            <label className={s.field}>
              <span className={s.label}>Joriy parol</span>
              <input
                type="password"
                className={s.input}
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </label>

            <label className={s.field}>
              <span className={s.label}>Yangi parol</span>
              <input
                type="password"
                className={s.input}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                disabled={loading}
              />
              <span className={s.hint}>Kamida 8 belgi</span>
            </label>

            <label className={s.field}>
              <span className={s.label}>Yangi parolni tasdiqlang</span>
              <input
                type="password"
                className={s.input}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </label>

            <div className={s.actions}>
              <button type="button" className={s.cancelBtn} onClick={handleClose} disabled={loading}>
                Bekor qilish
              </button>
              <button type="submit" className={s.saveBtn} disabled={loading || !oldPwd || !newPwd || !confirm}>
                {loading ? "Saqlanmoqda…" : "Saqlash"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
