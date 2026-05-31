// Fayl: client/src/App.tsx
// Maqsad: Telegram Desktop'ga o'xshash ikki-panelli asosiy interfeys quriladi.
import { useEffect } from "react";
import { useAuthStore } from "./stores/auth";
import { useThemeStore } from "./stores/theme";
import { useChatStore } from "./stores/chats";
import { connectSocket } from "./net/socket";
import { LoginPage } from "./pages/LoginPage";
import { ChatList } from "./components/ChatList";
import { ChatView } from "./components/ChatView";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/login.css";
import "./styles/chatlist.css";
import "./styles/chatview.css";

export default function App() {
  // Foydalanuvchi sessiyasi va mavzu (light/dark) holati
  const { token, hydrate } = useAuthStore();
  const { theme } = useThemeStore();
  const { loadChats } = useChatStore();

  useEffect(() => {
    // Saqlangan token yuklanadi (mavjud bo'lsa)
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    // Mavzu HTML root elementiga qo'llaniladi
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    // Token mavjud bo'lsa, suhbatlar yuklanadi va WebSocket ulanadi
    if (token) {
      void loadChats();
      connectSocket();
    }
  }, [token, loadChats]);

  if (!token) {
    // Token yo'q — kirish sahifasi ko'rsatiladi
    return <LoginPage />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <ChatList />
      </aside>
      <main className="chat-pane">
        <ChatView />
      </main>
    </div>
  );
}
