// Asosiy ilova komponenti.
import { useState, useCallback, useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
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
import ToastStack        from "@/components/Notifications/ToastStack";
import { BackNavigationProvider } from "@/contexts/BackNavigationContext";
import { initNotifications, setChatPaneVisible, setNotificationClickHandler } from "@/utils/notifications";
import { useChatStore } from "@/store/chatStore";

type MainView = "chat" | "settings";

function ChatApp() {
  const token    = useAuthStore((s) => s.token);
  const userId   = useAuthStore((s) => s.userId);
  const uiMode   = useAuthStore((s) => s.uiMode);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [mainView, setMainView]         = useState<MainView>("chat");
  const [activeFolder, setActiveFolder] = useState<FolderId>("all");

  useEffect(() => {
    void initNotifications();
    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setChatPaneVisible(mainView === "chat");
  }, [mainView]);

  useEffect(() => {
    setNotificationClickHandler((chatId) => {
      const t = useAuthStore.getState().token;
      if (!t) return;
      navigate("/");
      setMainView("chat");
      void useChatStore.getState().selectChat(chatId, t);
    });
    return () => setNotificationClickHandler(null);
  }, [navigate]);

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
    navigate("/admin");
  }, [navigate]);

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
    <BackNavigationProvider>
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
          ) : (
            <MessageArea />
          )}
        </div>
        <ToastStack />
      </div>
    </BackNavigationProvider>
  );
}

function AdminRoute() {
  const token           = useAuthStore((s) => s.token);
  const role            = useAuthStore((s) => s.role);
  const loading         = useAuthStore((s) => s.loading);
  const accounts        = useAuthStore((s) => s.accounts);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const uiMode          = useAuthStore((s) => s.uiMode);
  const bootstrap       = useAuthStore((s) => s.bootstrap);
  const navigate        = useNavigate();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    void initNotifications();
    void bootstrap().finally(() => setAuthReady(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setChatPaneVisible(false);
  }, []);

  const activeAccount = accounts.find((a) => a.userId === activeAccountId);
  const effectiveRole = role ?? activeAccount?.role ?? null;
  const showLogin     = !token || uiMode === "add_account";
  const bootstrapping = !authReady && (loading || (accounts.length > 0 && !token));

  if (bootstrapping) {
    return (
      <div className={styles.appShell}>
        <TitleBar />
        <div className={styles.loginWrap}>Yuklanmoqda…</div>
      </div>
    );
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

  if (effectiveRole !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <BackNavigationProvider>
      <div className={styles.appShell}>
        <TitleBar />
        <AccountUnlockModal />
        <AdminDashboard onBack={() => navigate("/")} />
        <ToastStack />
      </div>
    </BackNavigationProvider>
  );
}

function normalizePath(path: string): string {
  const p = path.replace(/\/+$/, "") || "/";
  return p;
}

export default function App() {
  const location = useLocation();
  const path = normalizePath(location.pathname);

  if (path !== "/" && path !== "/admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route path="/admin" element={<AdminRoute />} />
      <Route path="/"      element={<ChatApp />} />
    </Routes>
  );
}
