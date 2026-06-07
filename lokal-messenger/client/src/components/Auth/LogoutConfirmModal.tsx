// Joriy profildan chiqishni tasdiqlash modali.
import type { AccountSession } from "@/store/authStore";
import s from "./LogoutConfirmModal.module.css";

interface Props {
  account: AccountSession;
  avatarBg: string;
  onConfirm: () => void | Promise<void>;
  onCancel:  () => void;
  loading?:  boolean;
}

export default function LogoutConfirmModal({
  account, avatarBg, onConfirm, onCancel, loading = false,
}: Props) {
  const roleLabel = account.role === "admin" ? "Administrator" : "Foydalanuvchi";

  return (
    <div className={s.overlay} onClick={onCancel} role="presentation">
      <div
        className={s.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
      >
        <h2 id="logout-confirm-title" className={s.title}>
          Profildan chiqish
        </h2>

        <p className={s.question}>
          Haqiqatdan ham <strong>@{account.username}</strong> profilidan chiqishni xohlaysizmi?
        </p>

        <div className={s.profileCard}>
          <div className={s.avatar} style={{ background: avatarBg }}>
            {account.username.charAt(0).toUpperCase()}
          </div>
          <div className={s.profileInfo}>
            <div className={s.profileName}>@{account.username}</div>
            <div className={s.profileMeta}>{roleLabel}</div>
            <div className={s.profileId}>ID: {account.userId.slice(0, 8)}…</div>
          </div>
        </div>

        <p className={s.note}>
          Boshqa akkauntlar tizimda qoladi. Faqat ushbu profil chiqadi.
        </p>

        <div className={s.actions}>
          <button type="button" className={s.btnNo} onClick={onCancel} disabled={loading}>
            Yo&apos;q
          </button>
          <button type="button" className={s.btnYes} onClick={() => void onConfirm()} disabled={loading}>
            {loading ? "Chiqilmoqda…" : "Ha, chiqish"}
          </button>
        </div>
      </div>
    </div>
  );
}
