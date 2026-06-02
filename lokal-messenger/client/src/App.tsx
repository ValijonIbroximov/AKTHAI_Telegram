// Asosiy ilova komponenti.
// Autentifikatsiya holatiga qarab Login yoki Chat oynasini ko'rsatadi.
// SideDrawer hamburger menyudan ochiladi — SettingsModal o'chirildi.
import { useState } from "react";
import { useAuthStore }  from "@/store/authStore";
import LoginPage         from "@/components/Auth/LoginPage";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import SideDrawer        from "@/components/Layout/SideDrawer";
import styles            from "./App.module.css";

export default function App() {
  const token = useAuthStore((s) => s.token);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!token) {
    return <LoginPage />;
  }

  return (
    <div className={styles.layout}>
      {/* Slide-out menyu (Telegram uslubi) */}
      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Chap panel */}
      <ChatList onMenuOpen={() => setDrawerOpen(true)} />

      {/* O'ng panel */}
      <MessageArea />
    </div>
  );
}
