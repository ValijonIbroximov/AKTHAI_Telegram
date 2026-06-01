// Fayl: client/src/components/ChatView.tsx
// Maqsad: Tanlangan suhbat ochiladi, xabarlar ko'rsatiladi va yozish maydoni bo'ladi.
import React, { useEffect, useRef, useState } from "react";
import { useChatStore } from "../stores/chats";
import { useAuthStore } from "../stores/auth";

export function ChatView() {
  const { currentChat, messages, sendMessage } = useChatStore();
  const { userId } = useAuthStore();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Yangi xabar kelganda pastga skrol qilinadi
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (!currentChat) {
    return <div className="empty-state">Suhbatni tanlang</div>;
  }

  // Xabar shifrlanadi va serverga yuboriladi
  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text);
  }

  return (
    <>
      <header className="chat-header">
        <div className="avatar" style={{ background: currentChat.color }}>
          {currentChat.title?.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="chat-title">{currentChat.title}</div>
          <div className="chat-status">
            {currentChat.online ? "onlayn" : "oxirgi marta yaqinda"}
          </div>
        </div>
      </header>

      <div className="messages-pane" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === userId ? "out" : "in"}`}>
            <div className="bubble-text">{m.text}</div>
            <div className="bubble-meta">
              <span>{m.time}</span>
              {m.senderId === userId && (
                <span className="ticks">{m.read ? "✓✓" : m.delivered ? "✓✓" : "✓"}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={onSend}>
        <button type="button" className="icon-btn" title="Fayl biriktirish">
          📎
        </button>
        <textarea
          rows={1}
          placeholder="Xabar yozing..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        <button type="submit" className="icon-btn send" title="Yuborish">
          ➤
        </button>
      </form>
    </>
  );
}
