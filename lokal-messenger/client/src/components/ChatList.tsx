// Fayl: client/src/components/ChatList.tsx
// Maqsad: Yon panel — chatlar ro'yxati, qidiruv va yangi suhbat boshlash (foydalanuvchilar katalogi).
import { useEffect, useState } from "react";
import { useChatStore } from "../stores/chats";
import { useThemeStore } from "../stores/theme";
import { api } from "../net/api";

interface DirUser {
  id: string;
  display_name: string;
  rank_title?: string;
  unit_code?: string;
}

export function ChatList() {
  const { chats, currentChatId, selectChat, openPrivateChat } = useChatStore();
  const { theme, toggle } = useThemeStore();
  const [query, setQuery] = useState("");
  const [showDirectory, setShowDirectory] = useState(false);
  const [users, setUsers] = useState<DirUser[]>([]);

  useEffect(() => {
    // Yangi suhbat rejimi ochilganda foydalanuvchilar katalogi yuklanadi
    if (showDirectory && users.length === 0) {
      void api.listUsers().then(setUsers).catch(() => setUsers([]));
    }
  }, [showDirectory, users.length]);

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredUsers = users.filter((u) =>
    u.display_name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <div className="sidebar-header">
        <button
          className="icon-btn"
          title={showDirectory ? "Suhbatlar" : "Yangi suhbat"}
          onClick={() => setShowDirectory((v) => !v)}
        >
          {showDirectory ? "←" : "✎"}
        </button>
        <input
          className="search-box"
          placeholder="Qidirish..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="icon-btn"
          onClick={toggle}
          title={theme === "dark" ? "Yorug' rejim" : "Qorong'i rejim"}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
      </div>

      <div className="chat-items">
        {showDirectory ? (
          <>
            <div className="sidebar-section-title">Foydalanuvchilar</div>
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                className="chat-item"
                onClick={() => {
                  setShowDirectory(false);
                  void openPrivateChat(u.id, u.display_name);
                }}
              >
                <div className="avatar" style={{ background: "#3390ec" }}>
                  {u.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="chat-meta">
                  <div className="chat-row1">
                    <span className="chat-title">{u.display_name}</span>
                  </div>
                  <div className="chat-row2">
                    <span className="chat-preview">
                      {[u.rank_title, u.unit_code].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          filteredChats.map((c) => (
            <div
              key={c.id}
              className={`chat-item ${c.id === currentChatId ? "active" : ""}`}
              onClick={() => void selectChat(c.id)}
            >
              <div className="avatar" style={{ background: c.color || "#3390ec" }}>
                {c.title?.charAt(0).toUpperCase() ?? "?"}
              </div>
              <div className="chat-meta">
                <div className="chat-row1">
                  <span className="chat-title">{c.title}</span>
                  <span className="chat-time">{c.lastTime ?? ""}</span>
                </div>
                <div className="chat-row2">
                  <span className="chat-preview">{c.lastPreview ?? "Suhbatni oching"}</span>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
