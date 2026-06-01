// Asosiy ilova komponenti — autentifikatsiya holatiga qarab sahifalar almashadi.
import { useAuthStore }  from "@/store/authStore";
import LoginPage         from "@/components/Auth/LoginPage";
import ChatList          from "@/components/Chat/ChatList";
import MessageArea       from "@/components/Chat/MessageArea";
import styles            from "./App.module.css";

export default function App() {
  const token = useAuthStore((s) => s.token);

  // Token mavjud bo'lmasa kirish sahifasi ko'rsatiladi
  if (!token) {
    return <LoginPage />;
  }

  // Kirgan foydalanuvchiga asosiy interfeys ko'rsatiladi
  return (
    <div className={styles.layout}>
      <ChatList />
      <MessageArea />
    </div>
  );
}
