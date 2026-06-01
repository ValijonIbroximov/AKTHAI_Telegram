// Fayl: client/src/stores/chats.ts
// Maqsad: Chatlar va xabarlar holati boshqariladi. Shifrlash/ochish Rust tomonida
//         (invoke orqali) bajariladi; bu yerda faqat ochiq matn va metama'lumot turadi.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "./auth";
import { api } from "../net/api";
import { sendOverSocket } from "../net/socket";

export interface ChatItem {
  id: string;
  title: string;
  color?: string;
  online?: boolean;
  unread: number;
  lastTime?: string;
  lastPreview?: string;
  peerUserId?: string;
}

export interface UIMessage {
  id: string;
  clientMsgId?: string;
  senderId: string;
  text: string;
  time: string;
  delivered?: boolean;
  read?: boolean;
}

interface ChatStore {
  chats: ChatItem[];
  currentChatId: string | null;
  currentChat: ChatItem | null;
  messages: UIMessage[];
  loadChats: () => Promise<void>;
  selectChat: (id: string) => Promise<void>;
  openPrivateChat: (peerUserId: string, title: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  ingest: (raw: any) => Promise<void>;
}

// avatarColor — foydalanuvchi nomidan barqaror rang hosil qilinadi.
function avatarColor(seed: string): string {
  const palette = ["#3390ec", "#e17076", "#7bc862", "#ee7aae", "#a695e7", "#faa774"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// nowTime — joriy vaqt qisqa formatda qaytariladi.
function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  currentChatId: null,
  currentChat: null,
  messages: [],

  // Suhbatlar ro'yxati serverdan yuklanadi
  loadChats: async () => {
    const raw = await api.listChats();
    const chats: ChatItem[] = raw.map((c) => ({
      id: c.id,
      title: c.title || "Suhbat",
      color: avatarColor(c.peer_user_id || c.id),
      unread: c.unread,
      lastTime: c.last_time
        ? new Date(c.last_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : undefined,
      peerUserId: c.peer_user_id || undefined,
    }));
    set({ chats });
  },

  // Suhbat tanlanadi va shifrlangan tarix yuklanib, mahalliy ravishda ochiladi
  selectChat: async (id) => {
    const chat = get().chats.find((c) => c.id === id) || null;
    set({ currentChatId: id, currentChat: chat, messages: [] });
    if (!chat) return;

    const history = await api.chatHistory(id);
    const decoded: UIMessage[] = [];
    // Tarix eski-yangilik tartibida ochiladi (server DESC qaytaradi)
    for (const m of history.slice().reverse()) {
      let text = "[ochib bo'lmadi]";
      try {
        text = await invoke<string>("decrypt_incoming", {
          senderId: m.sender_id,
          msgType: m.msg_type,
          ciphertextB64: m.ciphertext,
        });
      } catch {
        // Ochib bo'lmagan xabar belgilab qo'yiladi
      }
      decoded.push({
        id: m.msg_id,
        senderId: m.sender_id,
        text,
        time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        delivered: m.delivered,
        read: m.read,
      });
    }
    set({ messages: decoded });
  },

  // Foydalanuvchi bilan shaxsiy suhbat ochiladi (yo'q bo'lsa yaratiladi)
  openPrivateChat: async (peerUserId, title) => {
    const res = await api.createPrivateChat(peerUserId);
    await get().loadChats();
    const existing = get().chats.find((c) => c.id === res.id);
    if (!existing) {
      // Ro'yxatga hali tushmagan bo'lsa, vaqtinchalik element qo'shiladi
      set((s) => ({
        chats: [
          {
            id: res.id,
            title,
            color: avatarColor(peerUserId),
            unread: 0,
            peerUserId,
          },
          ...s.chats,
        ],
      }));
    }
    await get().selectChat(res.id);
  },

  // Xabar shifrlanadi (Rust) va WebSocket orqali yuboriladi
  sendMessage: async (text) => {
    const chat = get().currentChat;
    const userId = useAuthStore.getState().userId!;
    if (!chat || !chat.peerUserId) return;

    const clientMsgId = crypto.randomUUID();

    // Rust tomonida shifrlash bajariladi; natijada shifrlangan baytlar qaytadi
    const enc = await invoke<{ ciphertext: string; msg_type: number }>("send_message", {
      recipientId: chat.peerUserId,
      plaintext: text,
    });

    // Shifrlangan paket WebSocket orqali serverga uzatiladi
    sendOverSocket({
      type: "msg.send",
      payload: {
        chat_id: chat.id,
        recipient_id: chat.peerUserId,
        ciphertext: enc.ciphertext,
        msg_type: enc.msg_type,
        client_msg_id: clientMsgId,
      },
    });

    // Optimistik tarzda UI'ga yoziladi (server tasdig'i keyin yangilaydi)
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: clientMsgId,
          clientMsgId,
          senderId: userId,
          text,
          time: nowTime(),
          delivered: false,
        },
      ],
    }));
  },

  // WebSocket'dan kelgan paket turi bo'yicha qayta ishlanadi
  ingest: async (raw) => {
    switch (raw?.type) {
      case "msg.recv": {
        const p = raw.payload;
        // Kelgan ciphertext Rust orqali ochiladi
        let text = "[ochib bo'lmadi]";
        try {
          text = await invoke<string>("decrypt_incoming", {
            senderId: p.sender_id,
            msgType: p.msg_type,
            ciphertextB64: p.ciphertext,
          });
        } catch {
          // Ochib bo'lmagan xabar belgilab qo'yiladi
        }

        // Yetkazib berildi tasdig'i serverga yuboriladi
        sendOverSocket({ type: "msg.delivered", payload: { msg_id: p.msg_id } });

        set((s) => {
          if (s.currentChatId !== p.chat_id) {
            // Boshqa suhbatdagi xabar — o'qilmaganlar soni oshiriladi
            return {
              chats: s.chats.map((c) =>
                c.id === p.chat_id ? { ...c, unread: c.unread + 1 } : c,
              ),
            };
          }
          // Ochiq suhbatga xabar qo'shiladi va darrov o'qildi deb belgilanadi
          sendOverSocket({
            type: "msg.read",
            payload: { msg_id: p.msg_id, sender_id: p.sender_id },
          });
          return {
            messages: [
              ...s.messages,
              { id: p.msg_id, senderId: p.sender_id, text, time: nowTime() },
            ],
          };
        });
        break;
      }

      case "msg.ack": {
        // Yuborilgan xabar serverda saqlandi — vaqtinchalik ID server ID'siga almashtiriladi
        const p = raw.payload;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.clientMsgId === p.client_msg_id
              ? { ...m, id: p.server_msg_id, delivered: true }
              : m,
          ),
        }));
        break;
      }

      case "msg.read": {
        // Adresat xabarni o'qidi
        const p = raw.payload;
        set((s) => ({
          messages: s.messages.map((m) => (m.id === p.msg_id ? { ...m, read: true } : m)),
        }));
        break;
      }
    }
  },
}));
