// O'ng panel — Telegram Desktop uslubidagi chat oynasi.
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore, PENDING_DECRYPT_LABEL } from "@/store/chatStore";
import { DECRYPT_ERROR_LABEL } from "@/crypto/adapter";
import { parseMediaPayload } from "@/crypto/fileCrypto";
import { formatPeerStatus } from "@/utils/presence";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import Avatar            from "@/components/Common/Avatar";
import MessageBubble     from "./MessageBubble";
import ImageViewer       from "./ImageViewer";
import InputBar          from "./InputBar";
import s                 from "./MessageArea.module.css";

const BOTTOM_THRESHOLD = 80;

export default function MessageArea() {
  const { userId, token } = useAuthStore();
  const { activeChatId, chats, messages, presenceMap, lastSeenMap, lastSeenHiddenMap, resetSessionWithPeer, closeChat } = useChatStore();
  const messagesRef  = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const scrollingToBottomRef = useRef(false);
  const chatEnteringRef = useRef(false);
  const prevChatIdRef = useRef<string | null>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [resetting, setResetting]       = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [, tick] = useState(0);

  const activeChat = chats.find(c => c.id === activeChatId);
  const msgs       = activeChatId ? (messages[activeChatId] ?? []) : [];
  const peerId     = activeChat?.peer_user_id ?? null;
  const isOnline   = peerId ? (presenceMap[peerId] ?? false) : false;
  const lastSeen   = peerId
    ? (lastSeenMap[peerId] ?? activeChat?.peer_last_seen_at ?? null)
    : null;
  const lastSeenHidden = peerId
    ? (lastSeenHiddenMap[peerId] ?? activeChat?.peer_last_seen_hidden ?? false)
    : false;
  const statusText = formatPeerStatus(isOnline, lastSeen, lastSeenHidden);

  const chatImages = useMemo(() => {
    const out: { messageId: string; payload: NonNullable<ReturnType<typeof parseMediaPayload>> }[] = [];
    for (const m of msgs) {
      if (m.msg_type !== "image") continue;
      const payload = parseMediaPayload(m.plaintext);
      if (payload) out.push({ messageId: m.id, payload });
    }
    return out;
  }, [msgs]);

  const hasSessionIssue = msgs.some(
    (m) => m.plaintext === PENDING_DECRYPT_LABEL || m.plaintext === DECRYPT_ERROR_LABEL
  );

  const snapToBottom = useCallback((): boolean => {
    const el = messagesRef.current;
    if (!el) return false;
    el.scrollTop = el.scrollHeight;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist <= BOTTOM_THRESHOLD;
    if (near) {
      pinnedToBottomRef.current = true;
      chatEnteringRef.current = false;
      setShowScrollDown(false);
    }
    return near;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = messagesRef.current;
    if (!el) return;
    if (behavior === "auto") {
      snapToBottom();
      return;
    }
    scrollingToBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [snapToBottom]);

  const updateScrollState = useCallback(() => {
    if (chatEnteringRef.current) return;
    const el = messagesRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist <= BOTTOM_THRESHOLD;
    pinnedToBottomRef.current = near;
    setShowScrollDown(!near);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    if (chatEnteringRef.current || scrollingToBottomRef.current) {
      if (scrollingToBottomRef.current) {
        const el = messagesRef.current;
        if (!el) return;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist <= BOTTOM_THRESHOLD) scrollingToBottomRef.current = false;
      }
      return;
    }
    updateScrollState();
  }, [updateScrollState]);

  const handleScrollDownClick = useCallback(() => {
    scrollingToBottomRef.current = true;
    pinnedToBottomRef.current = true;
    chatEnteringRef.current = false;
    setShowScrollDown(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  const lastMsg = msgs[msgs.length - 1];

  useLayoutEffect(() => {
    if (!activeChatId) return;

    if (prevChatIdRef.current !== activeChatId) {
      prevChatIdRef.current = activeChatId;
      chatEnteringRef.current = true;
      pinnedToBottomRef.current = true;
      scrollingToBottomRef.current = false;
      setShowScrollDown(false);
    }

    if (chatEnteringRef.current || pinnedToBottomRef.current) {
      snapToBottom();
    }
  }, [activeChatId, msgs.length, lastMsg?.id, lastMsg?.plaintext, snapToBottom]);

  // DOM balandligi o'zgarganda (rasm, kech yuklangan tarix) — qayta urinish
  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;

    const retrySnap = (attemptsLeft: number) => {
      if (cancelled || attemptsLeft <= 0) return;
      if (!chatEnteringRef.current && !pinnedToBottomRef.current) return;
      const ok = snapToBottom();
      if (!ok) requestAnimationFrame(() => retrySnap(attemptsLeft - 1));
    };

    retrySnap(16);
    const t1 = window.setTimeout(() => retrySnap(8), 50);
    const t2 = window.setTimeout(() => retrySnap(8), 200);
    const t3 = window.setTimeout(() => retrySnap(8), 500);
    const t4 = window.setTimeout(() => {
      if (chatEnteringRef.current) {
        snapToBottom();
        chatEnteringRef.current = false;
      }
    }, 1200);

    const el = messagesRef.current;
    if (!el) {
      return () => {
        cancelled = true;
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
      };
    }

    const ro = new ResizeObserver(() => {
      if (chatEnteringRef.current || pinnedToBottomRef.current) snapToBottom();
    });
    ro.observe(el);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      ro.disconnect();
    };
  }, [activeChatId, msgs.length, snapToBottom]);

  useEffect(() => {
    setViewerMessageId(null);
  }, [activeChatId]);

  // "N daqiqa oldin ko'rildi" matnini yangilash
  useEffect(() => {
    if (!peerId || isOnline) return;
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [peerId, isOnline]);

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

  const handleBack = useCallback(() => {
    if (viewerMessageId) {
      setViewerMessageId(null);
      return true;
    }
    if (headerMenuOpen) {
      setHeaderMenuOpen(false);
      return true;
    }
    if (activeChatId) {
      closeChat();
      return true;
    }
    return false;
  }, [viewerMessageId, headerMenuOpen, activeChatId, closeChat]);

  useRegisterBackHandler(handleBack, !!activeChat, BACK_PRIORITY.chat);

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
        <button
          className={s.backBtn}
          onClick={closeChat}
          aria-label="Suhbatlar ro'yxatiga qaytish"
          title="Orqaga"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <Avatar name={activeChat.title} size={36} online={isOnline} />

        <div className={s.headerInfo}>
          <span className={s.headerName}>{activeChat.title}</span>
          <span className={`${s.headerStatus} ${isOnline ? s.online : ""}`}>
            {statusText}
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
      <div className={s.messagesWrap}>
        <div
          className={s.messages}
          ref={messagesRef}
          onScroll={handleMessagesScroll}
        >
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
                onImageOpen={setViewerMessageId}
              />
            ))
          )}
        </div>

        {showScrollDown && (
          <button
            type="button"
            className={s.scrollDownBtn}
            onClick={handleScrollDownClick}
            aria-label="Eng pastga tushish"
            title="Eng pastga"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Kiritish paneli */}
      <InputBar
        chatId={activeChatId ?? ""}
        recipientId={activeChat.peer_user_id ?? activeChat.id}
        token={token ?? ""}
      />

      {viewerMessageId && token && chatImages.length > 0 && (
        <ImageViewer
          images={chatImages}
          initialMessageId={viewerMessageId}
          token={token}
          onClose={() => setViewerMessageId(null)}
        />
      )}
    </div>
  );
}
