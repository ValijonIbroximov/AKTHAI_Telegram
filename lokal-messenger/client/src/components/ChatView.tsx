// Fayl: client/src/components/ChatView.tsx
// Maqsad: Tanlangan suhbat ochiladi, xabarlar ko'rsatiladi va yozish maydoni bo'ladi.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useChatStore } from "../stores/chats";
import { useAuthStore } from "../stores/auth";
import "../styles/chatview.css";

export function ChatView() {
  const { currentChat, messages, sendMessage } = useChatStore();
  const { userId } = useAuthStore();
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  if (!currentChat) {
    return <div className="empty-state">Suhbatni tanlang</div>;
  }

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
        <div className="chat-header-info">
          <div className="chat-title">{currentChat.title}</div>
          <div className="chat-status">
            {currentChat.online ? "onlayn" : "oxirgi marta yaqinda"}
          </div>
        </div>

        <div className="chat-header-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`icon-btn chat-menu-btn ${menuOpen ? "active" : ""}`}
            aria-label="Ko'proq"
            title="Ko'proq"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="chat-header-dropdown">
              <button type="button" className="chat-header-drop-item" onClick={closeMenu}>
                Tarixni tozalash
              </button>
              <button
                type="button"
                className="chat-header-drop-item danger"
                onClick={closeMenu}
              >
                Chatni o'chirish
              </button>
            </div>
          )}
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
