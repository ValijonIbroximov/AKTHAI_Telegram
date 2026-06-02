// Asosiy ilova komponenti.
// mainView state orqali chat yoki settings sahifasi ko'rsatiladi.
import { useState, useCallback, useEffect } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import LoginPage         from "@/components/Auth/LoginPage";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import SideDrawer        from "@/components/Layout/SideDrawer";
import SettingsPage      from "@/components/Settings/SettingsPage";
import styles            from "./App.module.css";

type MainView = "chat" | "settings";

export default function App() {
  const token    = useAuthStore((s) => s.token);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const loadChats = useChatStore((s) => s.loadChats);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mainView, setMainView]     = useState<MainView>("chat");

  // Sahifa yuklanganda: localStorage token mavjud bo'lsa WS + kalitlar + chatlar tiklanadi
  useEffect(() => {
    bootstrap().then(() => {
      const t = useAuthStore.getState().token;
      if (t) loadChats(t);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSettings = useCallback(() => {
    setDrawerOpen(false);
    setMainView("settings");
  }, []);

  const closeSettings = useCallback(() => {
    setMainView("chat");
  }, []);

  if (!token) {
    return <LoginPage />;
  }

  return (
    <div className={styles.layout}>
      {/* Slide-out menyu */}
      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSettings={openSettings}
      />

      {/* Chap panel — har doim ko'rinadi */}
      <ChatList onMenuOpen={() => setDrawerOpen(true)} />

      {/* O'ng panel — chat yoki settings */}
      {mainView === "settings" ? (
        <SettingsPage onBack={closeSettings} />
      ) : (
        <MessageArea />
      )}
    </div>
  );
}
