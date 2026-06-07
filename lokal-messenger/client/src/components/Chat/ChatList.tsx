// Chap panel — Telegram Desktop uslubi: hamburger menyu + suhbatlar ro'yxati + foydalanuvchi qidiruvi.
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import ChatItem          from "./ChatItem";
import UserDirectory     from "./UserDirectory";
import s                 from "./ChatList.module.css";

import type { FolderId } from "@/components/Layout/ChatFolders";
import type { Chat } from "@/types";

interface Props {
  onMenuOpen?:   () => void;
  activeFolder?: FolderId;
}

// Avatar gradientlari (userSearch uchun)
function avatarColor(name: string): string {
  const colors = ["#2aabee","#34b56b","#e85d5d","#f5a623","#8e44ad","#1abc9c"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[h % colors.length]!;
}

/** Faqat kamida bitta xabari bor suhbatlar */
function chatHasMessages(chat: Chat): boolean {
  return chat.last_message != null;
}

export default function ChatList({ onMenuOpen, activeFolder = "all" }: Props) {
  const [search, setSearch]           = useState("");
  const { token, username }           = useAuthStore();
  const {
    chats, activeChatId,
    loadChats, selectChat,
    userResults, userLoading,
    searchUsers, clearUserResults, createChat,
  } = useChatStore();

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;
    loadChats(token);
    // WS handler chatStore.ts modul darajasida doimiy ro'yxatdan o'tgan — bu yerda takrorlanmaydi
  }, [token]);

  // Qidiruv matni o'zgarganda: mavjud suhbatlarni filtrlash + foydalanuvchi qidiruvi
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (val.length < 2) {
      clearUserResults();
      return;
    }
    searchDebounce.current = setTimeout(() => {
      if (token) searchUsers(val, token);
    }, 300);
  }, [token, searchUsers, clearUserResults]);

  const isUsersFolder = activeFolder === "users";

  const folderChats = (() => {
    if (isUsersFolder) return [];
    const withMessages = chats.filter(chatHasMessages);
    switch (activeFolder) {
      case "groups":   return withMessages.filter((c) => c.type === "group");
      case "channels": return withMessages.filter((c) => c.type === "channel");
      default:         return withMessages;
    }
  })();

  const filteredChats = search.trim()
    ? folderChats.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
    : folderChats;

  const isSearching = search.length >= 2;

  const headerTitle = isUsersFolder ? "Foydalanuvchilar" : "Xabarlar";
  const searchPlaceholder = isUsersFolder
    ? "Foydalanuvchi qidirish"
    : "Qidirish yoki yangi suhbat";

  return (
    <aside className={s.root}>
      {/* Sarlavha */}
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

        <span className={s.headerTitle}>{headerTitle}</span>

        <button
          className={s.iconBtn}
          aria-label="Yangi suhbat"
          title="Yangi suhbat"
          onClick={() => {
            const el = document.getElementById("chat-search-input");
            el?.focus();
          }}
        >
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
            id="chat-search-input"
            className={s.searchInput}
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          {search && (
            <button
              className={s.searchClear}
              onClick={() => { setSearch(""); clearUserResults(); }}
              aria-label="Tozalash"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Suhbatlar ro'yxati */}
      <div className={s.list} role="list" aria-label={isUsersFolder ? "Foydalanuvchilar" : "Suhbatlar"}>

        {isUsersFolder && token && (
          <UserDirectory
            token={token}
            search={search}
            onSelectUser={(user) => {
              createChat(user, token);
              setSearch("");
            }}
          />
        )}

        {!isUsersFolder && (
        <>
        {filteredChats.length > 0 && (
          <>
            {isSearching && (
              <p className={s.sectionLabel}>Suhbatlar</p>
            )}
            {filteredChats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                active={chat.id === activeChatId}
                onSelect={() => token && selectChat(chat.id, token)}
              />
            ))}
          </>
        )}

        {/* Foydalanuvchi qidiruv natijalari */}
        {isSearching && (
          <>
            {userLoading ? (
              <p className={s.sectionLabel}>Qidirilmoqda...</p>
            ) : userResults.length > 0 && (
              <>
                <p className={s.sectionLabel}>Foydalanuvchilar</p>
                {userResults.map((user) => (
                  <button
                    key={user.id}
                    className={s.userItem}
                    onClick={() => {
                      if (token) createChat(user, token);
                      setSearch("");
                    }}
                  >
                    <span
                      className={s.userAvatar}
                      style={{ background: avatarColor(user.display_name) }}
                    >
                      {user.display_name.charAt(0).toUpperCase()}
                    </span>
                    <span className={s.userInfo}>
                      <span className={s.userName}>{user.display_name}</span>
                      <span className={s.userSub}>@{user.username}</span>
                    </span>
                    <span className={s.startChatIcon} title="Suhbat boshlash">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                      </svg>
                    </span>
                  </button>
                ))}
              </>
            )}
          </>
        )}

        {/* Bo'sh holat */}
        {filteredChats.length === 0 && (!isSearching || userResults.length === 0) && !userLoading && (
          <p className={s.empty}>
            {isSearching
              ? 'Topilmadi. Yangi suhbat boshlash uchun foydalanuvchi nomini kiriting.'
              : username ? "Suhbatlar yo'q" : "Yuklanmoqda..."}
          </p>
        )}
        </>
        )}
      </div>
    </aside>
  );
}
