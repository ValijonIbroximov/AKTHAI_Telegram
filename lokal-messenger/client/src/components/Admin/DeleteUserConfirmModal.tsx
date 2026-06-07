// Foydalanuvchini o'chirishni tasdiqlash modali.
import type { User } from "@/types";
import s from "@/components/Auth/LogoutConfirmModal.module.css";

interface Props {
  user: User;
  avatarBg: string;
  onConfirm: () => void | Promise<void>;
  onCancel:  () => void;
  loading?:  boolean;
}

export default function DeleteUserConfirmModal({
  user, avatarBg, onConfirm, onCancel, loading = false,
}: Props) {
  return (
    <div className={s.overlay} onClick={onCancel} role="presentation">
      <div
        className={s.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
      >
        <h2 id="delete-user-title" className={s.title}>
          Foydalanuvchini o&apos;chirish
        </h2>

        <p className={s.question}>
          Haqiqatdan ham <strong>@{user.username}</strong> hisobini butunlay o&apos;chirmoqchimisiz?
        </p>

        <div className={s.profileCard}>
          <div className={s.avatar} style={{ background: avatarBg }}>
            {user.display_name.charAt(0).toUpperCase()}
          </div>
          <div className={s.profileInfo}>
            <div className={s.profileName}>{user.display_name}</div>
            <div className={s.profileMeta}>@{user.username}</div>
            <div className={s.profileId}>ID: {user.id.slice(0, 8)}…</div>
          </div>
        </div>

        <p className={s.note}>
          Bu amal qaytarib bo&apos;lmaydi. Suhbatlar, xabarlar va kalitlar o&apos;chiriladi.
        </p>

        <div className={s.actions}>
          <button type="button" className={s.btnNo} onClick={onCancel} disabled={loading}>
            Yo&apos;q
          </button>
          <button type="button" className={s.btnYes} onClick={() => void onConfirm()} disabled={loading}>
            {loading ? "O&apos;chirilmoqda…" : "Ha, o&apos;chirish"}
          </button>
        </div>
      </div>
    </div>
  );
}
