// Fayl: client/src/net/socket.ts
// Maqsad: Mijoz WebSocket ulanishini ushlab turadi va kiruvchi paketlarni
//         chats store'iga uzatadi. Faqat shifrlangan baytlar uzatiladi.
import { SERVER_WS } from "../config";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chats";

let ws: WebSocket | null = null;
let backoff = 1000;
let manualClose = false;

// connectSocket — sessiya tokeni bilan WebSocket ulanishi ochiladi.
export function connectSocket() {
  const token = useAuthStore.getState().token;
  if (!token) return;
  manualClose = false;

  ws = new WebSocket(`${SERVER_WS}/ws?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    backoff = 1000;
  };

  ws.onmessage = (ev) => {
    try {
      const env = JSON.parse(ev.data);
      void useChatStore.getState().ingest(env);
    } catch {
      // Noto'g'ri paket e'tiborsiz qoldiriladi
    }
  };

  ws.onclose = () => {
    if (manualClose) return;
    // Avtomatik qayta ulanish (eksponentsial kechikish bilan)
    setTimeout(connectSocket, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };

  ws.onerror = () => ws?.close();
}

// disconnectSocket — ulanish ataylab yopiladi (chiqishda).
export function disconnectSocket() {
  manualClose = true;
  ws?.close();
  ws = null;
}

// sendOverSocket — paket WebSocket orqali serverga yuboriladi.
export function sendOverSocket(payload: unknown): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}
