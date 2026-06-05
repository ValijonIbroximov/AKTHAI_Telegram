// Telegram Desktop uslubidagi xabar pufakchasi.
// Matn, rasm va hujjat xabarlarini ko'rsatadi.
import { useState, useEffect, useRef } from "react";
import type { Message } from "@/types";
import { DECRYPT_ERROR_LABEL } from "@/crypto/adapter";
import { MISSING_PLAINTEXT_LABEL, PENDING_DECRYPT_LABEL } from "@/utils/messageText";
import {
  parseMediaPayload,
  formatFileSize,
  decryptFile,
  fcFromB64,
  type MediaPayload,
} from "@/crypto/fileCrypto";
import { mediaApi } from "@/api/http";
import s from "./MessageBubble.module.css";

// ── Yordamchi ─────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function TickIcon({ read }: { read: boolean }) {
  return (
    <svg
      width="15" height="11"
      viewBox="0 0 15 11"
      fill="none"
      className={read ? s.tickRead : s.tick}
    >
      <path d="M1 5.5L4.5 9L10 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5.5 9L11 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={read ? 1 : 0}/>
    </svg>
  );
}

// ── Media component ────────────────────────────────────────────────────────

interface MediaProps {
  payload: MediaPayload;
}

function MediaContent({ payload }: MediaProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const revokeRef                 = useRef<string | null>(null);
  const isImage = payload.mime_type.startsWith("image/");

  // Object URL tozalash (memory leak oldini olish)
  useEffect(() => {
    return () => {
      if (revokeRef.current) URL.revokeObjectURL(revokeRef.current);
    };
  }, []);

  const loadAndDecrypt = async () => {
    if (loading || objectUrl) return;
    setLoading(true);
    setError(null);
    try {
      const { token } = (await import("@/store/authStore")).useAuthStore.getState();
      const encBlob = await mediaApi.downloadFile(token ?? "", payload.url);
      const decBlob = await decryptFile(encBlob, fcFromB64(payload.aes_key), fcFromB64(payload.iv));
      const typed   = new Blob([decBlob], { type: payload.mime_type });
      const url     = URL.createObjectURL(typed);
      revokeRef.current = url;
      setObjectUrl(url);
    } catch (e) {
      console.error("[Media] deshifrlash xatoligi:", e);
      setError("Yuklab bo'lmadi");
    } finally {
      setLoading(false);
    }
  };

  // Rasmlarni avtomatik yuklab deshifrlash
  useEffect(() => {
    if (isImage) { loadAndDecrypt(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDocDownload = async () => {
    if (!objectUrl) {
      await loadAndDecrypt();
    }
    // objectUrl bo'lsa, yuklab olish
    if (revokeRef.current) {
      const a    = document.createElement("a");
      a.href     = revokeRef.current;
      a.download = payload.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // ── Rasm ────────────────────────────────────────────────────────────────
  if (isImage) {
    if (error) {
      return (
        <div className={s.mediaError}>
          <span>🖼</span>
          <span>{payload.file_name}</span>
          <span className={s.mediaErrorText}>{error}</span>
          <button className={s.mediaRetryBtn} onClick={loadAndDecrypt}>
            Qayta urinish
          </button>
        </div>
      );
    }
    if (!objectUrl) {
      return (
        <div className={s.mediaImgPlaceholder}>
          <div className={s.mediaSpinner}/>
          <span className={s.mediaLoadingText}>{payload.file_name}</span>
        </div>
      );
    }
    return (
      <div className={s.mediaImgWrap}>
        <img
          src={objectUrl}
          alt={payload.file_name}
          className={s.mediaImg}
          onClick={() => window.open(objectUrl, "_blank")}
          title={`${payload.file_name} (${formatFileSize(payload.size)})`}
        />
      </div>
    );
  }

  // ── Hujjat / fayl ─────────────────────────────────────────────────────
  return (
    <div className={s.mediaDoc}>
      <div className={s.mediaDocIcon}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.6">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className={s.mediaDocInfo}>
        <span className={s.mediaDocName}>{payload.file_name}</span>
        <span className={s.mediaDocSize}>{formatFileSize(payload.size)}</span>
      </div>
      <button
        className={s.mediaDocBtn}
        onClick={handleDocDownload}
        disabled={loading}
        title="Yuklab olish"
      >
        {loading ? (
          <div className={s.mediaSpinnerSm}/>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                  strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="7 10 12 15 17 10"
                      strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="12" y1="15" x2="12" y2="3"
                  strokeLinecap="round"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Asosiy komponent ───────────────────────────────────────────────────────

interface Props { message: Message; isOwn: boolean; }

export default function MessageBubble({ message, isOwn }: Props) {
  const isSendError    = message.plaintext?.startsWith("⚠ Yuborilmadi");
  const isDecryptError = message.plaintext === DECRYPT_ERROR_LABEL;
  const isMissing      = message.plaintext === MISSING_PLAINTEXT_LABEL;
  const isPending      = message.plaintext === PENDING_DECRYPT_LABEL;
  const isUploading    = message.plaintext?.startsWith("⏳");
  const displayText    = message.plaintext ?? "";

  // Media xabar ekanligini aniqlaymiz
  const mediaPayload = parseMediaPayload(message.plaintext);
  const isMedia      = !!mediaPayload && !isSendError && !isDecryptError && !isMissing && !isPending;

  const bubbleClass = [
    s.bubble,
    isOwn ? s.bubbleOwn : s.bubbleIn,
    (isSendError || isDecryptError) ? s.bubbleError : "",
    isMissing ? s.bubbleMissing : "",
    isMedia ? s.bubbleMedia : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`${s.wrap} ${isOwn ? s.own : s.incoming}`}>
      <div className={bubbleClass}>

        {(isSendError || isDecryptError) ? (
          <p className={s.textError}>
            {isDecryptError && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            )}
            {displayText}
          </p>
        ) : isMissing ? (
          <p className={s.textMissing}>{displayText}</p>
        ) : isPending ? (
          <p className={s.textPending}>{displayText}</p>
        ) : isUploading ? (
          <p className={s.textPending}>{displayText}</p>
        ) : isMedia ? (
          <MediaContent payload={mediaPayload!} />
        ) : (
          <p className={`${s.text} selectable`}>{displayText}</p>
        )}

        <div className={s.meta}>
          <span className={s.time}>{fmtTime(message.created_at)}</span>
          {isOwn && (
            <span className={s.status}>
              {message.status === "sending" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="14"
                    style={{ animation: "spin 1s linear infinite", transformOrigin: "center" }}/>
                </svg>
              ) : (
                <TickIcon read={message.status === "read"} />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
