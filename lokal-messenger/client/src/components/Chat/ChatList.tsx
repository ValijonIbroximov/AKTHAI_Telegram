// Chap panel — Telegram Desktop uslubi: hamburger menyu + suhbatlar ro'yxati.
import { useState, useEffect } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import { wsClient }      from "@/api/ws";
import ChatItem          from "./ChatItem";
import s                 from "./ChatList.module.css";

interface Props {
  onMenuOpen?: () => void;
}

export default function ChatList({ onMenuOpen }: Props) {
  const [search, setSearch] = useState("");
  const { token, username } = useAuthStore();
  const { chats, activeChatId, loadChats, selectChat, handleWsEvent } = useChatStore();

  useEffect(() => {
    if (!token) return;
    loadChats(token);
    const off = wsClient.on(handleWsEvent);
    return off;
  }, [token]);

  const filtered = search.trim()
    ? chats.filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
    : chats;

  return (
    <aside className={s.root}>
      {/* Sarlavha — Telegram Desktop kabi */}
      <div className={s.header}>
        <button
          className={s.menuBtn}
          onClick={onMenuOpen}
          aria-label="Menyu"
          title="Menyu"
        >
          <span className={s.burger} />
          <span className={s.burger} />
          <span className={s.burger} />
        </button>

        <span className={s.headerTitle}>Xabarlar</span>

        <button className={s.iconBtn} aria-label="Qidirish" title="Qidirish">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M17 17l4 4" strokeLinecap="round"/>
          </svg>
        </button>
        <button className={s.iconBtn} aria-label="Yangi suhbat" title="Yangi suhbat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Qidiruv */}
      <div className={s.searchWrap}>
        <div className={s.searchInner}>
          <svg className={s.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M17 17l4 4" strokeLinecap="round"/>
          </svg>
          <input
            className={s.searchInput}
            type="search"
            placeholder="Qidirish"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={s.searchClear} onClick={() => setSearch("")} aria-label="Tozalash">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Suhbatlar ro'yxati */}
      <div className={s.list} role="list" aria-label="Suhbatlar">
        {filtered.length === 0 ? (
          <p className={s.empty}>
            {search ? "Topilmadi" : username ? "Suhbatlar yo'q" : "Yuklanmoqda..."}
          </p>
        ) : (
          filtered.map(chat => (
            <ChatItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              onSelect={() => token && selectChat(chat.id, token)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
