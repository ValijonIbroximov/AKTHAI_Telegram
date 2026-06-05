// Xabar kiritish paneli — Telegram Desktop uslubi.
// Enter → yuborish, Shift+Enter → yangi qator.
// 📎 tugmasi → fayl / rasm tanlash (AES-256-GCM + Signal bilan yuboriladi).
import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { useChatStore } from "@/store/chatStore";
import s from "./InputBar.module.css";

interface Props { chatId: string; recipientId: string; token: string; }

const ACCEPTED_TYPES = [
  "image/*",
  ".pdf", ".doc", ".docx",
  ".xls", ".xlsx",
  ".txt", ".zip", ".7z",
].join(",");

export default function InputBar({ chatId, recipientId }: Props) {
  const [text, setText]         = useState("");
  const [uploading, setUploading] = useState(false);
  const ref                     = useRef<HTMLTextAreaElement>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);
  const { sendMessage, sendFileMessage } = useChatStore();

  const getToken = async () => {
    const { token } = (await import("@/store/authStore")).useAuthStore.getState();
    return token ?? "";
  };

  // ── Matn yuborish ────────────────────────────────────────────────────────
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    await sendMessage(chatId, recipientId, t, await getToken());
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  // ── Fayl tanlash va yuborish ──────────────────────────────────────────────
  const onAttachClick = () => {
    if (uploading) return;
    fileRef.current?.click();
  };

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // input'ni tozalash (keyingi safar ham ishlasin)
    e.target.value = "";

    setUploading(true);
    try {
      await sendFileMessage(chatId, recipientId, file, await getToken());
    } finally {
      setUploading(false);
    }
  }, [chatId, recipientId, sendFileMessage]);

  const hasText = text.trim().length > 0;

  return (
    <div className={s.root}>
      {/* Yashirin fayl input'i */}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: "none" }}
        onChange={onFileChange}
      />

      {/* Fayl biriktirish tugmasi */}
      <button
        className={`${s.sideBtn} ${uploading ? s.sideBtnLoading : ""}`}
        onClick={onAttachClick}
        disabled={uploading}
        aria-label={uploading ? "Yuklanmoqda..." : "Fayl biriktirish"}
        title={uploading ? "Yuklanmoqda..." : "Fayl / rasm biriktirish"}
      >
        {uploading ? (
          /* Spinner */
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            className={s.spinner}
          >
            <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="14"/>
          </svg>
        ) : (
          /* Paperclip */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.7">
            <path
              d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Matn maydoni */}
      <div className={s.inputWrap}>
        <textarea
          ref={ref}
          className={s.textarea}
          placeholder="Xabar yozing..."
          value={text}
          onChange={e => setText(e.target.value)}
          onInput={onInput}
          onKeyDown={onKey}
          rows={1}
          maxLength={4096}
        />
      </div>

      {/* Yuborish / mikrofon tugmasi */}
      <button
        className={`${s.sendBtn} ${hasText ? s.sendActive : s.micActive}`}
        onClick={hasText ? send : undefined}
        disabled={!hasText}
        aria-label={hasText ? "Yuborish" : "Ovozli xabar"}
      >
        {hasText ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.8">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeLinecap="round"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" strokeLinecap="round"/>
          </svg>
        )}
      </button>
    </div>
  );
}
