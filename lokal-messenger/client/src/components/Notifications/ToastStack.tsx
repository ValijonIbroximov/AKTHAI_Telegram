// Telegram uslubidagi ichki bildirishnomalar (toast)
import { useCallback, useEffect, useState } from "react";
import { gradientCssFor } from "@/utils/avatarGradient";
import {
  subscribeToasts,
  dismissToast,
  openNotificationTarget,
  type ToastItem,
} from "@/utils/notifications";
import s from "./ToastStack.module.css";

const AUTO_DISMISS_MS = 5500;

function ToastCard({
  item,
  onOpen,
  onDismiss,
}: {
  item:      ToastItem;
  onOpen:    (chatId: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);

  const close = useCallback(() => {
    setExiting(true);
    window.setTimeout(() => onDismiss(item.id), 260);
  }, [item.id, onDismiss]);

  useEffect(() => {
    const t = window.setTimeout(close, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [close]);

  return (
    <div
      className={`${s.toast} ${exiting ? s.toastExiting : ""}`}
      role="alert"
      onClick={() => onOpen(item.chatId)}
    >
      <div
        className={s.avatar}
        style={{ background: gradientCssFor(item.senderName) }}
        aria-hidden
      >
        {(item.senderName.trim() || "?").charAt(0).toUpperCase()}
      </div>

      <div className={s.body}>
        <div className={s.header}>
          <span className={s.name}>{item.senderName.trim() || "Yangi xabar"}</span>
          <span className={s.badge}>Xabar</span>
        </div>
        <p className={s.preview}>{item.preview}</p>
      </div>

      <button
        type="button"
        className={s.close}
        aria-label="Yopish"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

export default function ToastStack() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  const handleDismiss = useCallback((id: string) => {
    dismissToast(id);
  }, []);

  const handleOpen = useCallback((chatId: string) => {
    const item = toasts.find((t) => t.chatId === chatId);
    if (item) dismissToast(item.id);
    void openNotificationTarget(chatId);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className={s.stack} aria-live="polite">
      {toasts.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onOpen={handleOpen}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
