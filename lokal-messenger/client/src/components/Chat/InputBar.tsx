// Xabar kiritish paneli — Enter yuboradi, Shift+Enter yangi qator.
import { useState, useRef, KeyboardEvent } from "react";
import { useChatStore } from "@/store/chatStore";
import s from "./InputBar.module.css";

interface Props { chatId: string; recipientId: string; token: string; }

export default function InputBar({ chatId, recipientId }: Props) {
  const [text, setText]     = useState("");
  const ref                 = useRef<HTMLTextAreaElement>(null);
  const { sendMessage }     = useChatStore();

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    // token authStore'dan olinadi — bunda prop berib yuborishdan qochiladi
    const { token: tok } = (await import("@/store/authStore")).useAuthStore.getState();
    await sendMessage(chatId, recipientId, t, tok ?? "");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 110) + "px";
  };

  const hasText = text.trim().length > 0;

  return (
    <div className={s.root}>
      <button className={s.attachBtn} disabled aria-label="Fayl" title="Tez orada">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <textarea
        ref={ref}
        className={s.textarea}
        placeholder="// xabar yozing..."
        value={text}
        onChange={e => setText(e.target.value)}
        onInput={onInput}
        onKeyDown={onKey}
        rows={1}
        maxLength={4096}
      />

      <button
        className={`${s.sendBtn} ${hasText ? s.active : ""}`}
        onClick={send}
        disabled={!hasText}
        aria-label="Yuborish"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
