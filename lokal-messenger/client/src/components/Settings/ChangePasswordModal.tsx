// Parolni o'zgartirish modali — Maxfiylik va xavfsizlik bo'limi.
import { useState, FormEvent } from "react";
import { useAuthStore } from "@/store/authStore";
import PasswordInput from "@/components/Common/PasswordInput";
import s from "./ChangePasswordModal.module.css";

interface Props {
  open:             boolean;
  onClose:          () => void;
  /** Birinchi kirish — joriy parol so'ralmaydi */
  skipOldPassword?:   boolean;
}

export default function ChangePasswordModal({ open, onClose, skipOldPassword = false }: Props) {
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
    if (!newPwd.trim()) {
      setError("Yangi parol bo'sh bo'lmasligi kerak");
      return;
    }
    if (newPwd !== confirm) {
      setError("Yangi parollar mos kelmaydi");
      return;
    }
    setLoading(true);
    try {
      await changePassword(skipOldPassword ? "" : oldPwd, newPwd);
      setSuccess(true);
      setTimeout(handleClose, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parol o'zgartirilmadi");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = skipOldPassword
    ? Boolean(newPwd && confirm)
    : Boolean(oldPwd && newPwd && confirm);

  return (
    <div className={s.overlay} onClick={handleClose} role="presentation">
      <div className={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={s.header}>
          <h2 className={s.title}>
            {skipOldPassword ? "Yangi parol o'rnatish" : "Parolni o'zgartirish"}
          </h2>
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

            {!skipOldPassword && (
              <label className={s.field}>
                <span className={s.label}>Joriy parol</span>
                <PasswordInput
                  value={oldPwd}
                  onChange={setOldPwd}
                  autoComplete="current-password"
                  disabled={loading}
                  required
                />
              </label>
            )}

            <label className={s.field}>
              <span className={s.label}>Yangi parol</span>
              <PasswordInput
                value={newPwd}
                onChange={setNewPwd}
                autoComplete="new-password"
                disabled={loading}
                required
              />
            </label>

            <label className={s.field}>
              <span className={s.label}>Yangi parolni tasdiqlang</span>
              <PasswordInput
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                disabled={loading}
                required
              />
            </label>

            <div className={s.actions}>
              <button type="button" className={s.cancelBtn} onClick={handleClose} disabled={loading}>
                Bekor qilish
              </button>
              <button type="submit" className={s.saveBtn} disabled={loading || !canSubmit}>
                {loading ? "Saqlanmoqda…" : "Saqlash"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
