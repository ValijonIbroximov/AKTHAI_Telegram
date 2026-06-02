// Asosiy ilova komponenti — autentifikatsiya holatiga qarab sahifalar almashadi.
import { useState } from "react";
import { useAuthStore }  from "@/store/authStore";
import LoginPage         from "@/components/Auth/LoginPage";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import SettingsModal     from "@/components/Settings/SettingsModal";
import styles            from "./App.module.css";

export default function App() {
  const token = useAuthStore((s) => s.token);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!token) {
    return <LoginPage onSettings={() => setSettingsOpen(true)} />;
  }

  return (
    <div className={styles.layout}>
      <ChatList onSettings={() => setSettingsOpen(true)} />
      <MessageArea />
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
