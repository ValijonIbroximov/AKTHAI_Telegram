// O'ng panel — Telegram Desktop uslubidagi chat oynasi.
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore, PENDING_DECRYPT_LABEL } from "@/store/chatStore";
import { DECRYPT_ERROR_LABEL } from "@/crypto/adapter";
import Avatar            from "@/components/Common/Avatar";
import MessageBubble     from "./MessageBubble";
import InputBar          from "./InputBar";
import s                 from "./MessageArea.module.css";

export default function MessageArea() {
  const { userId, token } = useAuthStore();
  const { activeChatId, chats, messages, presenceMap, resetSessionWithPeer } = useChatStore();
  const bottomRef    = useRef<HTMLDivElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [resetting, setResetting]       = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const activeChat = chats.find(c => c.id === activeChatId);
  const msgs       = activeChatId ? (messages[activeChatId] ?? []) : [];
  const peerId     = activeChat?.peer_user_id ?? null;
  const isOnline   = peerId ? (presenceMap[peerId] ?? false) : false;

  const hasSessionIssue = msgs.some(
    (m) => m.plaintext === PENDING_DECRYPT_LABEL || m.plaintext === DECRYPT_ERROR_LABEL
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  // Menyu tashqariga bosish → yopish
  useEffect(() => {
    if (!headerMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [headerMenuOpen]);

  const closeMenu = useCallback(() => setHeaderMenuOpen(false), []);

  const handleResetSession = async () => {
    if (!activeChatId || !peerId || !token || resetting) return;
    setResetting(true);
    try {
      await resetSessionWithPeer(activeChatId, peerId, token);
    } catch (e) {
      console.error("[X3DH] Sessiyani tiklash xatoligi:", e);
    } finally {
      setResetting(false);
    }
  };

  // Suhbat tanlanmagan holat
  if (!activeChat) {
    return (
      <div className={s.root}>
        <div className={s.empty}>
          <div className={s.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <p className={s.emptyTitle}>Suhbatni tanlang</p>
          <p className={s.emptyDesc}>Xabarlarni ko'rish uchun chap tarafdan suhbat tanlang</p>
          <div className={s.emptyE2ee}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            E2E shifrlangan · Signal Protocol · AES-256-GCM
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {/* Chat sarlavhasi */}
      <div className={s.header}>
        <Avatar name={activeChat.title} size={36} online={isOnline} />

        <div className={s.headerInfo}>
          <span className={s.headerName}>{activeChat.title}</span>
          <span className={`${s.headerStatus} ${isOnline ? s.online : ""}`}>
            {isOnline ? "onlayn" : "so'nggi marta uzoq vaqt oldin"}
          </span>
        </div>

        {/* O'ng tomondagi tugmalar */}
        <div className={s.headerActions}>
          <button className={s.actionBtn} aria-label="Qidirish" title="Suhbatda qidirish">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7"/>
              <path d="M17 17l4 4" strokeLinecap="round"/>
            </svg>
          </button>
          <button className={s.actionBtn} aria-label="Qo'ng'iroq" title="Qo'ng'iroq" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" strokeLinecap="round"/>
            </svg>
          </button>

          {/* 3 nuqtali kontekst menyu */}
          <div className={s.menuWrap} ref={headerMenuRef}>
            <button
              className={`${s.actionBtn} ${headerMenuOpen ? s.actionBtnActive : ""}`}
              aria-label="Ko'proq"
              title="Ko'proq"
              onClick={() => setHeaderMenuOpen((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
              </svg>
            </button>

            {headerMenuOpen && (
              <div className={s.dropMenu}>
                <button className={s.dropItem} onClick={closeMenu}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Ovozni o'chirish
                </button>
                <button className={s.dropItem} onClick={closeMenu}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  Profilni ko'rish
                </button>
                <div className={s.dropDivider} />
                <button className={s.dropItem} onClick={closeMenu}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <polyline points="3 6 5 6 21 6" strokeLinecap="round"/>
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6" strokeLinecap="round"/>
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round"/>
                  </svg>
                  Tarixni tozalash
                </button>
                <button className={`${s.dropItem} ${s.dropItemDanger}`} onClick={closeMenu}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round"/>
                  </svg>
                  Chatni o'chirish
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {hasSessionIssue && peerId && (
        <div className={s.sessionBanner}>
          <span className={s.sessionBannerText}>
            Shifrlash sinxronizatsiyasi buzilgan. Yangi X3DH kalit almashinuvi kerak.
          </span>
          <button
            type="button"
            className={s.sessionBannerBtn}
            onClick={handleResetSession}
            disabled={resetting}
          >
            {resetting ? "Tiklanmoqda…" : "Sessiyani qayta tiklash"}
          </button>
        </div>
      )}

      {/* Xabarlar maydoni */}
      <div className={s.messages}>
        {msgs.length === 0 ? (
          <div className={s.noMsgs}>
            <div className={s.noMsgsBox}>Suhbat boshlash uchun xabar yuboring</div>
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

      {/* Kiritish paneli */}
      <InputBar
        chatId={activeChatId ?? ""}
        recipientId={activeChat.peer_user_id ?? activeChat.id}
        token={token ?? ""}
      />
    </div>
  );
}
