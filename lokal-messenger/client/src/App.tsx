// Asosiy ilova komponenti.
import { useState, useCallback, useEffect } from "react";
import { useAuthStore }  from "@/store/authStore";
import { useChatStore }  from "@/store/chatStore";
import LoginPage         from "@/components/Auth/LoginPage";
import AccountUnlockModal from "@/components/Auth/AccountUnlockModal";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import SideDrawer        from "@/components/Layout/SideDrawer";
import TitleBar          from "@/components/Layout/TitleBar";
import SettingsPage      from "@/components/Settings/SettingsPage";
import ServerSetup       from "@/components/Setup/ServerSetup";
import AdminDashboard    from "@/components/Admin/AdminDashboard";
import styles            from "./App.module.css";
import { initNotifications } from "@/utils/notifications";
import { hasServerUrl }  from "@/config/serverConfig";

type MainView = "chat" | "settings" | "admin";

export default function App() {
  const token    = useAuthStore((s) => s.token);
  const userId   = useAuthStore((s) => s.userId);
  const uiMode   = useAuthStore((s) => s.uiMode);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const loadChats = useChatStore((s) => s.loadChats);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mainView, setMainView]     = useState<MainView>("chat");
  const [serverReady, setServerReady] = useState(hasServerUrl);

  useEffect(() => {
    void initNotifications();
    bootstrap().then(() => {
      const t = useAuthStore.getState().token;
      if (t) loadChats(t);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Akkaunt almashganda chatlar qayta yuklanadi (holat onAccountSwitch da tozalanadi)
  useEffect(() => {
    if (!token || !userId) return;
    void loadChats(token);
    setMainView("chat");
  }, [userId, token, loadChats]);

  const openSettings = useCallback(() => {
    setDrawerOpen(false);
    setMainView("settings");
  }, []);

  const closeSettings = useCallback(() => {
    setMainView("chat");
  }, []);

  const openAdmin = useCallback(() => {
    setDrawerOpen(false);
    setMainView("admin");
  }, []);

  const showLogin = !token || uiMode === "add_account";

  if (!serverReady) {
    return <ServerSetup onDone={() => setServerReady(true)} />;
  }

  if (showLogin) {
    return (
      <div className={styles.appShell}>
        <TitleBar />
        <div className={styles.loginWrap}>
          <LoginPage />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.appShell}>
      <TitleBar />
      <AccountUnlockModal />
      <div className={styles.layout}>
        <SideDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSettings={openSettings}
          onAdmin={openAdmin}
        />
        <ChatList onMenuOpen={() => setDrawerOpen(true)} />
        {mainView === "settings" ? (
          <SettingsPage onBack={closeSettings} />
        ) : mainView === "admin" ? (
          <AdminDashboard onBack={() => setMainView("chat")} />
        ) : (
          <MessageArea />
        )}
      </div>
    </div>
  );
}
