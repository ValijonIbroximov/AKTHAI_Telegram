// Xabar kirish paneli — Enter yuboradi, Shift+Enter yangi qator.
import { useState, useRef, KeyboardEvent } from "react";
import { useChatStore } from "@/store/chatStore";
import styles from "./InputBar.module.css";

interface InputBarProps {
  chatId:      string;
  recipientId: string;
  token:       string;
}

export default function InputBar({ chatId, recipientId, token }: InputBarProps) {
  const [text, setText]     = useState("");
  const textareaRef         = useRef<HTMLTextAreaElement>(null);
  const { sendMessage }     = useChatStore();

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    // Textarea balandligi qayta tiklanadi
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage(chatId, recipientId, trimmed, token);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Textarea xabar kiritilgan sayin o'sadi (maks 5 qator)
  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  return (
    <div className={styles.root}>
      {/* Qo'shimcha tugmalar (fayl, emoji — kelajak uchun) */}
      <button className={styles.attachBtn} aria-label="Fayl biriktirish" disabled title="Tez orada">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Matn maydon */}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        placeholder="Xabar yozing..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        rows={1}
        maxLength={4096}
        aria-label="Xabar yozing"
      />

      {/* Yuborish tugmasi */}
      <button
        className={`${styles.sendBtn} ${text.trim() ? styles.sendActive : ""}`}
        onClick={handleSend}
        disabled={!text.trim()}
        aria-label="Yuborish"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
