// Asosiy ilova komponenti.
import { useState, useCallback, useEffect } from "react";
import { useAuthStore }  from "@/store/authStore";
import LoginPage         from "@/components/Auth/LoginPage";
import AccountUnlockModal from "@/components/Auth/AccountUnlockModal";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import SideDrawer        from "@/components/Layout/SideDrawer";
import ChatFolders, { type FolderId } from "@/components/Layout/ChatFolders";
import TitleBar          from "@/components/Layout/TitleBar";
import SettingsPage      from "@/components/Settings/SettingsPage";
import AdminDashboard    from "@/components/Admin/AdminDashboard";
import styles            from "./App.module.css";
import { initNotifications } from "@/utils/notifications";

type MainView = "chat" | "settings" | "admin";

export default function App() {
  const token    = useAuthStore((s) => s.token);
  const userId   = useAuthStore((s) => s.userId);
  const uiMode   = useAuthStore((s) => s.uiMode);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [mainView, setMainView]         = useState<MainView>("chat");
  const [activeFolder, setActiveFolder] = useState<FolderId>("all");

  useEffect(() => {
    void initNotifications();
    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Akkaunt almashganda asosiy ko'rinish
  useEffect(() => {
    if (!token || !userId) return;
    setMainView("chat");
  }, [userId, token]);

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
        <ChatFolders activeFolder={activeFolder} onFolderChange={setActiveFolder} />
        <SideDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSettings={openSettings}
          onAdmin={openAdmin}
        />
        <ChatList onMenuOpen={() => setDrawerOpen(true)} activeFolder={activeFolder} />
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
