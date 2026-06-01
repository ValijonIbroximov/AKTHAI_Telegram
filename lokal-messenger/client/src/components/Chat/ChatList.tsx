// Chap panel: suhbatlar ro'yxati, qidiruv, foydalanuvchi profili.
import { useState, useEffect } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import { wsClient }      from "@/api/ws";
import ChatItem          from "./ChatItem";
import styles            from "./ChatList.module.css";

export default function ChatList() {
  const [search, setSearch]       = useState("");
  const { token, username, role, logout } = useAuthStore();
  const { chats, activeChatId, loadChats, selectChat, handleWsEvent } = useChatStore();

  // Suhbatlar bir marta yuklanadi va WS tinglovchisi o'rnatiladi
  useEffect(() => {
    if (!token) return;
    loadChats(token);
    const unsubscribe = wsClient.on(handleWsEvent);
    return unsubscribe;
  }, [token]);

  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className={styles.root}>
      {/* Yuqori sarlavha */}
      <div className={styles.header}>
        <button className={styles.menuBtn} aria-label="Menyu" title="Menyu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <span className={styles.headerTitle}>Xabarlar</span>
        <button className={styles.editBtn} aria-label="Yangi suhbat" title="Yangi suhbat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Qidiruv */}
      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
          <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Qidirish"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Suhbatlar ro'yxati */}
      <div className={styles.list} role="list">
        {filtered.length === 0 ? (
          <p className={styles.empty}>
            {search ? "Natija topilmadi" : "Suhbatlar yo'q"}
          </p>
        ) : (
          filtered.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              onSelect={() => token && selectChat(chat.id, token)}
            />
          ))
        )}
      </div>

      {/* Foydalanuvchi profili (pastki qism) */}
      <div className={styles.footer}>
        <div className={styles.footerUser}>
          <div className={styles.footerAvatar}>
            {(username ?? "?").charAt(0).toUpperCase()}
          </div>
          <div className={styles.footerInfo}>
            <span className={styles.footerName}>{username}</span>
            <span className={styles.footerRole}>{role === "admin" ? "Administrator" : "Foydalanuvchi"}</span>
          </div>
        </div>
        <button
          className={styles.logoutBtn}
          onClick={logout}
          aria-label="Chiqish"
          title="Chiqish"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}
