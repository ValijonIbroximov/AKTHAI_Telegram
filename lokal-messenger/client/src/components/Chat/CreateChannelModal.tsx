// Yangi kanal yaratish modali.
import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import s from "./CreateChannelModal.module.css";

interface Props {
  open:     boolean;
  onClose:  () => void;
  onCreate: (title: string, description: string) => Promise<void>;
}

export default function CreateChannelModal({ open, onClose, onCreate }: Props) {
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setError("");
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  useRegisterBackHandler(
    useCallback(() => {
      if (!open || busy) return false;
      onClose();
      return true;
    }, [open, busy, onClose]),
    open,
    BACK_PRIORITY.modal,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError("Kanal nomi kiritilishi shart");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate(t, description.trim());
      onClose();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className={s.overlay} onClick={busy ? undefined : onClose} role="presentation">
      <div
        className={s.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Yangi kanal"
      >
        <div className={s.header}>
          <h2 className={s.title}>Yangi kanal</h2>
          <button type="button" className={s.closeBtn} onClick={onClose} disabled={busy} aria-label="Yopish">
            ×
          </button>
        </div>

        <form className={s.form} onSubmit={(e) => void handleSubmit(e)}>
          <div className={s.field}>
            <label className={s.label} htmlFor="channel-title">Kanal nomi *</label>
            <input
              ref={titleRef}
              id="channel-title"
              className={s.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Masalan: Yangiliklar"
              maxLength={128}
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="channel-desc">Tavsif (ixtiyoriy)</label>
            <textarea
              id="channel-desc"
              className={s.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kanal haqida qisqacha ma'lumot"
              rows={3}
              maxLength={500}
              disabled={busy}
            />
          </div>

          <p className={s.hint}>
            Kanalda matn, rasm, video va fayllarni joylashingiz mumkin.
          </p>

          {error && <div className={s.error}>{error}</div>}

          <div className={s.actions}>
            <button type="button" className={s.cancelBtn} onClick={onClose} disabled={busy}>
              Bekor qilish
            </button>
            <button type="submit" className={s.submitBtn} disabled={busy}>
              {busy ? "Yaratilmoqda…" : "Kanal yaratish"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
