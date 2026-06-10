// Asosiy ilova komponenti.
import { useState, useCallback, useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore }  from "@/store/authStore";
import LoginPage         from "@/components/Auth/LoginPage";
import AccountUnlockModal from "@/components/Auth/AccountUnlockModal";
import FirstLoginPasswordPrompt from "@/components/Auth/FirstLoginPasswordPrompt";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import CreateChannelModal from "@/components/Chat/CreateChannelModal";
import SideDrawer        from "@/components/Layout/SideDrawer";
import ChatFolders, { type FolderId } from "@/components/Layout/ChatFolders";
import TitleBar          from "@/components/Layout/TitleBar";
import SettingsPage      from "@/components/Settings/SettingsPage";
import AdminDashboard    from "@/components/Admin/AdminDashboard";
import styles            from "./App.module.css";
import { BackNavigationProvider } from "@/contexts/BackNavigationContext";
import { initNotifications, setChatPaneVisible, setNotificationClickHandler } from "@/utils/notifications";
import { useChatStore } from "@/store/chatStore";

type MainView = "chat" | "settings";

/** localStorage yuklangach bootstrap — faol sessiya bo'lsa qayta ishlamaydi */
function useSessionBootstrap(): boolean {
  const token     = useAuthStore((s) => s.token);
  const accounts  = useAuthStore((s) => s.accounts);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const [hydrated, setHydrated]       = useState(() => useAuthStore.persist.hasHydrated());
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    // Sessiya allaqachon faol yoki tiklanadigan akkaunt yo'q
    if (token || accounts.length === 0) {
      setBootstrapped(true);
      return;
    }

    let cancelled = false;
    void bootstrap().finally(() => {
      if (!cancelled) setBootstrapped(true);
    });
    return () => { cancelled = true; };
  }, [hydrated, bootstrap, token, accounts.length]);

  if (!hydrated) return false;
  if (token || accounts.length === 0) return true;
  return bootstrapped;
}

function ChatApp() {
  const token    = useAuthStore((s) => s.token);
  const userId   = useAuthStore((s) => s.userId);
  const uiMode   = useAuthStore((s) => s.uiMode);
  const canCreateChannel = useAuthStore((s) => s.canCreateChannel);
  const createChannel = useChatStore((s) => s.createChannel);
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [mainView, setMainView]         = useState<MainView>("chat");
  const [activeFolder, setActiveFolder] = useState<FolderId>("all");

  useEffect(() => {
    void initNotifications();
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

  const openCreateChannel = useCallback(() => {
    setChannelModalOpen(true);
  }, []);

  const handleCreateChannel = useCallback(async (title: string, description: string) => {
    if (!token) throw new Error("Tizimga kiring");
    await createChannel(title, description, token);
    setActiveFolder("channels");
  }, [token, createChannel]);

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
        <FirstLoginPasswordPrompt />
        <div className={styles.layout}>
          <ChatFolders activeFolder={activeFolder} onFolderChange={setActiveFolder} />
          <SideDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSettings={openSettings}
            onAdmin={openAdmin}
            onCreateChannel={openCreateChannel}
            canCreateChannel={canCreateChannel}
          />
          <CreateChannelModal
            open={channelModalOpen}
            onClose={() => setChannelModalOpen(false)}
            onCreate={handleCreateChannel}
          />
          <ChatList onMenuOpen={() => setDrawerOpen(true)} activeFolder={activeFolder} />
          {mainView === "settings" ? (
            <SettingsPage onBack={closeSettings} />
          ) : (
            <MessageArea />
          )}
        </div>
      </div>
    </BackNavigationProvider>
  );
}

function AdminRoute() {
  const token           = useAuthStore((s) => s.token);
  const role            = useAuthStore((s) => s.role);
  const accounts        = useAuthStore((s) => s.accounts);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const navigate        = useNavigate();

  useEffect(() => {
    void initNotifications();
  }, []);

  useEffect(() => {
    setChatPaneVisible(false);
  }, []);

  const activeAccount = accounts.find((a) => a.userId === activeAccountId);
  const effectiveRole = role ?? activeAccount?.role ?? null;
  const isAdmin       = Boolean(token && effectiveRole === "admin");

  if (!isAdmin) {
    return (
      <div className={styles.appShell}>
        <TitleBar />
        <div className={styles.loginWrap}>
          <LoginPage adminMode />
        </div>
      </div>
    );
  }

  return (
    <BackNavigationProvider>
      <div className={styles.appShell}>
        <TitleBar />
        <AccountUnlockModal />
        <AdminDashboard onBack={() => navigate("/")} />
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
  const sessionReady = useSessionBootstrap();

  if (path !== "/" && path !== "/admin") {
    return <Navigate to="/" replace />;
  }

  if (!sessionReady) {
    return (
      <div className={styles.appShell}>
        <TitleBar />
        <div className={styles.loginWrap}>Yuklanmoqda…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/admin/*" element={<AdminRoute />} />
      <Route path="/*"       element={<ChatApp />} />
    </Routes>
  );
}
