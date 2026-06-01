// Suhbat ro'yxatidagi yagona qator elementi.
import Avatar   from "@/components/Common/Avatar";
import type { Chat } from "@/types";
import styles   from "./ChatItem.module.css";

// Vaqt formati: bugun HH:mm, qolganlar dd.mm
function formatTime(iso: string): string {
  const d     = new Date(iso);
  const now   = new Date();
  const today = now.toDateString() === d.toDateString();
  if (today) {
    return d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" });
}

interface ChatItemProps {
  chat:     Chat;
  active:   boolean;
  onSelect: () => void;
}

export default function ChatItem({ chat, active, onSelect }: ChatItemProps) {
  const preview = chat.last_message?.preview ?? "Xabar yo'q";
  const time    = chat.last_message ? formatTime(chat.last_message.created_at) : "";

  return (
    <div
      className={`${styles.root} ${active ? styles.active : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      aria-selected={active}
    >
      <Avatar name={chat.title} size={46} />

      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.title}>{chat.title}</span>
          <span className={styles.time}>{time}</span>
        </div>
        <div className={styles.bottom}>
          <span className={styles.preview}>{preview}</span>
          {chat.unread_count > 0 && (
            <span className={styles.badge}>
              {chat.unread_count > 99 ? "99+" : chat.unread_count}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
