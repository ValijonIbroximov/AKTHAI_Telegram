// O'ng panel: xabar tarixi sarlavhasi va kirish maydoni.
import { useEffect, useRef } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import MessageBubble     from "./MessageBubble";
import InputBar          from "./InputBar";
import s                 from "./MessageArea.module.css";

const COLORS = ["#1a6b8a","#1a6b4a","#6b4a1a","#6b1a4a","#4a1a6b","#1a4a6b"];
function colorFor(str: string) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function MessageArea() {
  const { userId, token }  = useAuthStore();
  const { activeChatId, chats, messages, presenceMap } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find(c => c.id === activeChatId);
  const msgs       = activeChatId ? (messages[activeChatId] ?? []) : [];
  const isOnline   = activeChatId ? (presenceMap[activeChatId] ?? false) : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  if (!activeChat) {
    return (
      <div className={s.root}>
        <div className={s.empty}>
          <div className={s.emptyGlyph}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <span className={s.emptyLabel}>Suhbat tanlang</span>
          <div className={s.emptySecure}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            E2EE · Signal Protocol · AES-256-GCM
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {/* Sarlavha */}
      <div className={s.header}>
        <div
          className={s.headerAvatar}
          style={{ background: colorFor(activeChat.title) }}
          aria-hidden
        >
          {activeChat.title.charAt(0).toUpperCase()}
        </div>

        <div className={s.headerInfo}>
          <span className={s.headerName}>{activeChat.title}</span>
          <span className={`${s.headerSub} ${isOnline ? s.online : ""}`}>
            {isOnline ? "● ONLINE" : "○ OFFLINE"}
          </span>
        </div>

        <div className={s.headerEncBadge}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          E2EE
        </div>

        <button className={s.headerIconBtn} aria-label="Qidirish">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M17 17l4 4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Xabarlar */}
      <div className={s.messages}>
        {msgs.length === 0 ? (
          <div className={s.noMsgs}>
            <div className={s.noMsgsIcon}>▣</div>
            <div className={s.noMsgsText}>// xabar yo'q</div>
          </div>
        ) : (
          msgs.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.sender_id === userId || msg.sender_id === "me"}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <InputBar
        chatId={activeChatId ?? ""}
        recipientId={activeChat.id}
        token={token ?? ""}
      />
    </div>
  );
}
