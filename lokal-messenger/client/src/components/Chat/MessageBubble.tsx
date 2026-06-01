// Yagona xabar "pufagi" — o'zining va kiruvchining uslublari farqli.
import type { Message } from "@/types";
import styles from "./MessageBubble.module.css";

// Xabar vaqtini HH:mm formatida qaytaradi
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// Xabar holati uchun belgichalar
function StatusIcon({ status }: { status: Message["status"] }) {
  if (status === "sending")   return <span className={styles.statusSending}>•••</span>;
  if (status === "sent")      return <span className={styles.statusSent} title="Yuborildi">✓</span>;
  if (status === "delivered") return <span className={styles.statusDelivered} title="Yetkazildi">✓✓</span>;
  if (status === "read")      return <span className={styles.statusRead} title="O'qildi">✓✓</span>;
  return null;
}

interface MessageBubbleProps {
  message: Message;
  isOwn:   boolean;
}

export default function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const text = message.plaintext ?? "[shifr ochilmadi 🔒]";

  return (
    <div className={`${styles.wrap} ${isOwn ? styles.own : styles.incoming}`}>
      <div className={`${styles.bubble} ${isOwn ? styles.bubbleOwn : styles.bubbleIn}`}>
        {/* Xabar matni */}
        <p className={styles.text + " selectable"}>{text}</p>

        {/* Vaqt va holat */}
        <div className={styles.meta}>
          <span className={styles.time}>{formatTime(message.created_at)}</span>
          {isOwn && <StatusIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}
