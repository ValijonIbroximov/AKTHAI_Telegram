// Chap panel: suhbatlar ro'yxati, qidiruv, foydalanuvchi holati.
import { useState, useEffect } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import { wsClient }      from "@/api/ws";
import ChatItem          from "./ChatItem";
import s                 from "./ChatList.module.css";

interface Props { onSettings?: () => void }

export default function ChatList({ onSettings }: Props) {
  const [search, setSearch] = useState("");
  const { token, username, role, logout } = useAuthStore();
  const { chats, activeChatId, loadChats, selectChat, handleWsEvent } = useChatStore();

  useEffect(() => {
    if (!token) return;
    loadChats(token);
    const off = wsClient.on(handleWsEvent);
    return off;
  }, [token]);

  const filtered = chats.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className={s.root}>
      {/* Sarlavha */}
      <div className={s.header}>
        <span className={s.headerTitle}>Xabarlar</span>
        <button className={s.iconBtn} aria-label="Yangi suhbat" title="Yangi suhbat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
          </svg>
        </button>
        {onSettings && (
          <button className={s.iconBtn} onClick={onSettings} aria-label="Sozlamalar" title="Sozlamalar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
            </svg>
          </button>
        )}
      </div>

      {/* Qidiruv */}
      <div className={s.searchBox}>
        <div className={s.searchInner}>
          <span className={s.searchIcon}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7"/>
              <path d="M17 17l4 4" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            className={s.searchInput}
            type="search"
            placeholder="qidirish..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Ro'yxat */}
      <div className={s.list} role="list">
        {filtered.length === 0
          ? <p className={s.empty}>{search ? "// topilmadi" : "// suhbat yo'q"}</p>
          : filtered.map(chat => (
              <ChatItem
                key={chat.id}
                chat={chat}
                active={chat.id === activeChatId}
                onSelect={() => token && selectChat(chat.id, token)}
              />
            ))
        }
      </div>

      {/* Foydalanuvchi */}
      <div className={s.footer}>
        <div className={s.footerAvatar}>
          {(username ?? "?").charAt(0).toUpperCase()}
        </div>
        <div className={s.footerInfo}>
          <span className={s.footerName}>{username}</span>
          <span className={s.footerRole}>
            {role === "admin" ? "ADMIN" : "USER"}
          </span>
        </div>
        <button className={s.logoutBtn} onClick={logout} aria-label="Chiqish" title="Chiqish">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}
