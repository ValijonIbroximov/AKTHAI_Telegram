// Telegram Desktop uslubidagi xabar pufakchasi.
//
// msg_type === "text"  → oddiy matn
// msg_type === "image" → AES-256-GCM deshifrlangan rasm (<img>)
// msg_type === "file"  → Yuklab olish tugmasi
//
// E2EE media oqimi:
//   plaintext = JSON { url, aes_key, iv, file_name, mime_type, size }
//   → serverdan blob yuklanadi → AES-GCM bilan deshifrlanadi
//   → URL.createObjectURL(blob) bilan ko'rsatiladi
//   → komponent unmount bo'lganda URL.revokeObjectURL chaqiriladi (memory leak yo'q)
import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "@/types";
import { DECRYPT_ERROR_LABEL } from "@/crypto/adapter";
import { MISSING_PLAINTEXT_LABEL, PENDING_DECRYPT_LABEL } from "@/utils/messageText";
import {
  parseMediaPayload,
  formatFileSize,
  fileTypeLabel,
  type MediaPayload,
} from "@/crypto/fileCrypto";
import { loadDecryptedMedia } from "@/utils/mediaLoader";
import s from "./MessageBubble.module.css";

// ── Yordamchi ─────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function StatusTicks({ status }: { status: Message["status"] }) {
  if (status === "read") {
    return <span className={s.ticksRead} aria-label="O'qilgan">✓✓</span>;
  }
  return <span className={s.ticks} aria-label="Yuborildi">✓</span>;
}

// ── MediaContent ──────────────────────────────────────────────────────────
//
// Rasmlar uchun avtomatik yuklab-deshifrlaш.
// Hujjatlar uchun "Yuklab olish" tugmasi.
// Har safar komponent unmount bo'lganda object URL tozalanadi.

type MediaState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error"; message: string };

interface MediaContentProps {
  payload:       MediaPayload;
  msgType:       "image" | "video" | "file";
  onImageClick?: () => void;
  onMediaClick?: () => void;
  compact?:      boolean;
  albumRow?:     boolean;
}

export function MediaContent({
  payload, msgType, onImageClick, onMediaClick, compact = false, albumRow = false,
}: MediaContentProps) {
  const openViewer = onMediaClick ?? onImageClick;
  const [state, setState] = useState<MediaState>({ status: "idle" });
  const [spoilerRevealed, setSpoilerRevealed] = useState(!payload.spoiler);
  // Revoke uchun ref — state'dan mustaqil
  const objUrlRef = useRef<string | null>(null);

  // Komponent unmount → object URL tozalaш (memory leak oldini olish)
  useEffect(() => {
    return () => {
      if (objUrlRef.current) {
        URL.revokeObjectURL(objUrlRef.current);
        objUrlRef.current = null;
      }
    };
  }, []);

  // Rasmlar / videolar sahifaga kirishi bilan avtomatik yuklash
  useEffect(() => {
    if (msgType === "image" || msgType === "video") {
      fetchAndDecrypt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgType, payload.url]);

  const fetchAndDecrypt = useCallback(async () => {
    if (state.status === "loading" || state.status === "ready") return;
    setState({ status: "loading" });

    try {
      // Token'ni olish — har safar yangilangan versiyasi
      const { token } = (await import("@/store/authStore")).useAuthStore.getState();
      if (!token) throw new Error("Autentifikatsiya token'i yo'q");

      const typedBlob = await loadDecryptedMedia(token, payload);
      const objUrl = URL.createObjectURL(typedBlob);
      objUrlRef.current = objUrl;
      setState({ status: "ready", objectUrl: objUrl });

    } catch (e) {
      console.error("[MediaContent] deshifrlash xatoligi:", e);
      setState({
        status:  "error",
        message: e instanceof Error ? e.message : "Noma'lum xatolik",
      });
    }
  }, [payload.url, payload.aes_key, payload.iv, payload.mime_type, state.status]);

  // Hujjatni brauzerda yuklash trigger
  const triggerDownload = useCallback(async () => {
    let objUrl: string | null = null;

    if (state.status === "ready") {
      objUrl = (state as { status: "ready"; objectUrl: string }).objectUrl;
    } else {
      // Agar hali yuklanmagan bo'lsa — avval yuklab-deshifrlash
      await fetchAndDecrypt();
      // fetchAndDecrypt async, shuning uchun objUrlRef tekshiramiz
      objUrl = objUrlRef.current;
    }

    if (!objUrl) return;
    const a    = document.createElement("a");
    a.href     = objUrl;
    a.download = payload.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [state, fetchAndDecrypt, payload.file_name]);

  // ── Rasm rendering ──────────────────────────────────────────────────────
  if (msgType === "image") {
    if (state.status === "loading") {
      return (
        <div className={s.mediaImgPlaceholder}>
          <div className={s.mediaSpinner} />
          <span className={s.mediaLoadingText}>{payload.file_name}</span>
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div className={s.mediaError}>
          <span className={s.mediaErrorIcon}>🖼</span>
          <span className={s.mediaErrorName}>{payload.file_name}</span>
          <span className={s.mediaErrorText}>{state.message}</span>
          <button className={s.mediaRetryBtn} onClick={() => {
            setState({ status: "idle" });
            // useEffect qayta ishlamaydi, shuning uchun qo'lda chaqirish
            fetchAndDecrypt();
          }}>
            Qayta urinish
          </button>
        </div>
      );
    }

    if (state.status === "ready") {
      const imgClass = [
        s.mediaImg,
        payload.spoiler && !spoilerRevealed ? s.mediaSpoiler : "",
        payload.spoiler && spoilerRevealed ? s.mediaSpoilerRevealed : "",
      ].filter(Boolean).join(" ");

      return (
        <div className={compact ? s.mediaImgWrapCompact : s.mediaImgWrap}>
          <img
            src={state.objectUrl}
            alt={payload.file_name}
            className={imgClass + (compact ? ` ${s.mediaImgCompact}` : "")}
            loading="lazy"
            onClick={() => {
              if (payload.spoiler && !spoilerRevealed) {
                setSpoilerRevealed(true);
                return;
              }
              openViewer?.();
            }}
            title={
              payload.spoiler && !spoilerRevealed
                ? "Spoiler — ochish uchun bosing"
                : `${payload.file_name} (${formatFileSize(payload.size)})`
            }
          />
        </div>
      );
    }

    // idle
    return (
      <div className={s.mediaImgPlaceholder}>
        <div className={s.mediaSpinner} />
        <span className={s.mediaLoadingText}>{payload.file_name}</span>
      </div>
    );
  }

  // ── Video rendering ─────────────────────────────────────────────────────
  if (msgType === "video") {
    if (state.status === "loading") {
      return (
        <div className={s.mediaImgPlaceholder}>
          <div className={s.mediaSpinner} />
          <span className={s.mediaLoadingText}>{payload.file_name}</span>
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div className={s.mediaError}>
          <span className={s.mediaErrorIcon}>🎬</span>
          <span className={s.mediaErrorName}>{payload.file_name}</span>
          <span className={s.mediaErrorText}>{state.message}</span>
          <button className={s.mediaRetryBtn} onClick={() => {
            setState({ status: "idle" });
            fetchAndDecrypt();
          }}>
            Qayta urinish
          </button>
        </div>
      );
    }

    if (state.status === "ready") {
      const vidClass = [
        s.mediaVideo,
        compact ? s.mediaVideoCompact : "",
        payload.spoiler && !spoilerRevealed ? s.mediaSpoiler : "",
        payload.spoiler && spoilerRevealed ? s.mediaSpoilerRevealed : "",
      ].filter(Boolean).join(" ");

      return (
        <div
          className={compact ? s.mediaVideoWrapCompact : s.mediaVideoWrap}
          onClick={() => {
            if (payload.spoiler && !spoilerRevealed) {
              setSpoilerRevealed(true);
              return;
            }
            openViewer?.();
          }}
          role={openViewer ? "button" : undefined}
          tabIndex={openViewer ? 0 : undefined}
          onKeyDown={openViewer ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openViewer();
            }
          } : undefined}
        >
          <video
            src={state.objectUrl}
            className={vidClass}
            muted
            playsInline
            preload="metadata"
            draggable={false}
          />
          {!payload.spoiler || spoilerRevealed ? (
            <span className={s.mediaPlayBadge} aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </span>
          ) : null}
        </div>
      );
    }

    return (
      <div className={s.mediaImgPlaceholder}>
        <div className={s.mediaSpinner} />
        <span className={s.mediaLoadingText}>{payload.file_name}</span>
      </div>
    );
  }

  // ── Hujjat / fayl rendering ─────────────────────────────────────────────
  const isDownloading = state.status === "loading";
  const docClass = albumRow
    ? s.mediaDocAlbumRow
    : compact
      ? s.mediaDocCompact
      : s.mediaDoc;

  return (
    <div className={docClass}>
      <div className={s.mediaDocIcon}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.6">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="14 2 14 8 20 8"
                    strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <div className={s.mediaDocInfo}>
        <span className={s.mediaDocName} title={payload.file_name}>{payload.file_name}</span>
        {albumRow ? (
          <span className={s.mediaDocType}>{fileTypeLabel(payload)}</span>
        ) : (
          <span className={s.mediaDocSize}>{formatFileSize(payload.size)}</span>
        )}
      </div>

      <button
        className={s.mediaDocBtn}
        onClick={triggerDownload}
        disabled={isDownloading}
        title={isDownloading ? "Yuklanmoqda..." : "Yuklab olish"}
      >
        {isDownloading ? (
          <div className={s.mediaSpinnerSm} />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                  strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="7 10 12 15 17 10"
                      strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ── MessageBubble (asosiy komponent) ──────────────────────────────────────

interface Props {
  message:      Message;
  isOwn:        boolean;
  onImageOpen?: (messageId: string) => void;
}

function visualMsgType(msg: Message): "image" | "video" | "file" | null {
  if (msg.msg_type === "image") return "image";
  if (msg.msg_type === "video") return "video";
  if (msg.msg_type === "file") return "file";
  return null;
}

export default function MessageBubble({ message, isOwn, onImageOpen }: Props) {
  const pt = message.plaintext ?? "";

  const isSendError    = pt.startsWith("⚠ Yuborilmadi");
  const isDecryptError = pt === DECRYPT_ERROR_LABEL;
  const isMissing      = pt === MISSING_PLAINTEXT_LABEL;
  const isPending      = pt === PENDING_DECRYPT_LABEL;
  const isUploading    = pt.startsWith("⏳");

  // Media xabar: image / video / file + MediaPayload JSON
  const visualType = visualMsgType(message);
  const isMedia    = visualType !== null && !isSendError && !isDecryptError && !isMissing && !isPending;

  // MediaPayload'ni parse qilish (faqat media xabarlar uchun)
  const mediaPayload = isMedia ? parseMediaPayload(pt) : null;

  const bubbleClass = [
    s.bubble,
    isOwn ? s.bubbleOwn : s.bubbleIn,
    (isSendError || isDecryptError) ? s.bubbleError  : "",
    isMissing                        ? s.bubbleMissing : "",
    isMedia && mediaPayload          ? s.bubbleMedia   : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`${s.wrap} ${isOwn ? s.own : s.incoming}`}>
      <div className={bubbleClass}>

        {/* ── Xato holatlari ────────────────────────────────────────────── */}
        {(isSendError || isDecryptError) ? (
          <p className={s.textError}>
            {isDecryptError && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9"  y2="15"/>
                <line x1="9"  y1="9" x2="15" y2="15"/>
              </svg>
            )}
            {pt}
          </p>

        ) : isMissing ? (
          <p className={s.textMissing}>{pt}</p>

        ) : isPending ? (
          <p className={s.textPending}>{pt}</p>

        ) : isUploading ? (
          <p className={s.textPending}>{pt}</p>

        ) : isMedia && mediaPayload ? (
          <>
            <MediaContent
              payload={mediaPayload}
              msgType={visualType!}
              onMediaClick={
                (visualType === "image" || visualType === "video") && onImageOpen
                  ? () => onImageOpen(message.id)
                  : undefined
              }
            />
            {mediaPayload.caption?.trim() && (
              <p className={`${s.text} ${s.mediaCaption} selectable`}>{mediaPayload.caption}</p>
            )}
          </>

        ) : isMedia && !mediaPayload ? (
          /* MediaPayload parse bo'lmadi — fallback matn */
          <p className={s.textMissing}>⚠ Media ma'lumot noto'g'ri</p>

        ) : (
          /* ── Oddiy matn ────────────────────────────────────────────────── */
          <p className={`${s.text} selectable`}>{pt}</p>
        )}

        {/* ── Vaqt va holat ──────────────────────────────────────────────── */}
        <div className={s.meta}>
          <span className={s.time}>{fmtTime(message.created_at)}</span>
          {isOwn && (
            <span className={s.status}>
              {message.status === "sending" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="9"
                    strokeDasharray="56" strokeDashoffset="14"
                    style={{ animation: "spin 1s linear infinite", transformOrigin: "center" }}/>
                </svg>
              ) : (
                <StatusTicks status={message.status} />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
