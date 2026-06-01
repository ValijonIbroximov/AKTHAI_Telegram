// O'ng panel: xabar tarixi va kirish maydoni.
import { useEffect, useRef } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import MessageBubble     from "./MessageBubble";
import InputBar          from "./InputBar";
import Avatar            from "@/components/Common/Avatar";
import styles            from "./MessageArea.module.css";

export default function MessageArea() {
  const { userId, token } = useAuthStore();
  const { activeChatId, chats, messages, presenceMap } = useChatStore();

  const bottomRef = useRef<HTMLDivElement>(null);
  const activeChat = chats.find((c) => c.id === activeChatId);
  const msgs       = activeChatId ? (messages[activeChatId] ?? []) : [];

  // Yangi xabar kelganda pastga siljitiladi
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  // Hech qanday suhbat tanlanmagan holat
  if (!activeChat) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <svg viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="40" r="36" fill="rgba(82,136,193,0.08)" />
            <path d="M26 30h28M26 40h20M26 50h16" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" opacity=".6"/>
          </svg>
        </div>
        <p className={styles.emptyText}>Suhbatni tanlang</p>
        <p className={styles.emptyHint}>Xabarlaringiz E2EE bilan himoyalangan</p>
      </div>
    );
  }

  // Suhbatdosh online holati
  const isOnline = activeChatId ? presenceMap[activeChatId] ?? false : false;

  return (
    <div className={styles.root}>
      {/* Sarlavha */}
      <div className={styles.header}>
        <Avatar name={activeChat.title} size={38} online={isOnline} />
        <div className={styles.headerInfo}>
          <span className={styles.headerName}>{activeChat.title}</span>
          <span className={`${styles.headerStatus} ${isOnline ? styles.online : ""}`}>
            {isOnline ? "online" : "oxirgi ko'rish: noma'lum"}
          </span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.iconBtn} aria-label="Qidirish">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Xabarlar maydoni */}
      <div className={styles.messages}>
        {msgs.length === 0 ? (
          <p className={styles.noMessages}>Hali xabar yo'q</p>
        ) : (
          msgs.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.sender_id === userId || msg.sender_id === "me"}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Xabar kiritish paneli */}
      <InputBar
        chatId={activeChatId ?? ""}
        recipientId={activeChat.id}
        token={token ?? ""}
      />
    </div>
  );
}
