// Birinchi kirishda parolni o'zgartirish taklifi.
import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import ChangePasswordModal from "@/components/Settings/ChangePasswordModal";
import s from "@/components/Settings/ChangePasswordModal.module.css";

export default function FirstLoginPasswordPrompt() {
  const mustChange = useAuthStore((st) => st.mustChangePassword);
  const dismiss    = useAuthStore((st) => st.dismissMustChangePassword);
  const [showChange, setShowChange] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!mustChange) return null;

  if (showChange) {
    return (
      <ChangePasswordModal
        open
        skipOldPassword
        onClose={() => setShowChange(false)}
      />
    );
  }

  const onLater = async () => {
    setBusy(true);
    try {
      await dismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.overlay} role="presentation">
      <div className={s.modal} role="dialog" aria-modal="true">
        <div className={s.header}>
          <h2 className={s.title}>Birinchi kirish</h2>
        </div>
        <p style={{ margin: "0 0 20px", color: "var(--text-2, #aaa)", lineHeight: 1.5 }}>
          Bu sizning birinchi kirishingiz. Xavfsizlik uchun parolni o&apos;zgartirishni xohlaysizmi?
        </p>
        <div className={s.actions}>
          <button type="button" className={s.cancelBtn} onClick={onLater} disabled={busy}>
            {busy ? "…" : "Keyinroq"}
          </button>
          <button type="button" className={s.saveBtn} onClick={() => setShowChange(true)} disabled={busy}>
            Ha, o&apos;zgartirish
          </button>
        </div>
      </div>
    </div>
  );
}
