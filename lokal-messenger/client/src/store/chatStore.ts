// Suhbatlar, xabarlar va foydalanuvchi qidiruv holati.
import { create } from "zustand";
import { encryptMessage, decryptMessage, establishSession } from "@/crypto/adapter";
import { chatApi, keysApi, userApi } from "@/api/http";
import { wsClient } from "@/api/ws";
import type {
  Chat, Message, User,
  WsEvent, WsMsgRecv, WsMsgAck,
} from "@/types";

interface ChatState {
  chats:        Chat[];
  activeChatId: string | null;
  messages:     Record<string, Message[]>;
  presenceMap:  Record<string, boolean>;
  loading:      boolean;

  // Foydalanuvchi qidiruvi
  userResults:  User[];
  userLoading:  boolean;

  // Asosiy amallar
  loadChats:      (token: string) => Promise<void>;
  selectChat:     (chatId: string, token: string) => Promise<void>;
  createChat:     (peer: User, token: string) => Promise<void>;
  sendMessage:    (chatId: string, recipientId: string, plaintext: string, token: string) => Promise<void>;
  handleWsEvent:  (event: WsEvent) => void;

  // Qidiruv
  searchUsers:    (query: string, token: string) => Promise<void>;
  clearUserResults: () => void;
}

// X3DH sessiyasini o'rnatishga urinish (mavjud bo'lmasa)
async function tryEstablishSession(
  peerId: string,
  token:  string
): Promise<void> {
  try {
    const bundle = await keysApi.getBundle(token, peerId);
    await establishSession(peerId, JSON.stringify(bundle));
  } catch {
    // Kalit bundle mavjud bo'lmasa — yangi sessiya imkonsiz
  }
}

// Shifrlangan xabarni ochishga urinish, muvaffaqiyatsiz bo'lsa fallback
async function tryDecrypt(
  chatId:     string,
  senderId:   string,
  ciphertext: string
): Promise<string> {
  if (!ciphertext) return "";
  try {
    return await decryptMessage(chatId, senderId, ciphertext);
  } catch {
    return "[Shifrlangan xabar]";
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats:        [],
  activeChatId: null,
  messages:     {},
  presenceMap:  {},
  loading:      false,
  userResults:  [],
  userLoading:  false,

  // Suhbatlar ro'yxati serverdan yuklanadi
  loadChats: async (token) => {
    set({ loading: true });
    try {
      const chats = await chatApi.list(token);
      set({ chats, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  // Suhbat tanlanganida tarixi yuklanadi va E2EE ochiladi
  selectChat: async (chatId, token) => {
    set({ activeChatId: chatId });

    // Avval mavjud xabarlar bo'lsa — qayta yuklamaslik
    const existing = get().messages[chatId];
    if (existing?.length) return;

    // Sherik ID si aniqlash (sessiya kerak bo'lishi mumkin)
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat?.peer_user_id) {
      await tryEstablishSession(chat.peer_user_id, token);
    }

    try {
      const rawMsgs = await chatApi.history(token, chatId);

      const decrypted = await Promise.all(
        rawMsgs.map(async (msg) => {
          if (msg.msg_type === "text" && msg.ciphertext) {
            const plaintext = await tryDecrypt(chatId, msg.sender_id, msg.ciphertext);
            return { ...msg, plaintext };
          }
          return { ...msg, plaintext: null };
        })
      );

      set((s) => ({
        messages: { ...s.messages, [chatId]: decrypted },
      }));
    } catch {
      set((s) => ({
        messages: { ...s.messages, [chatId]: [] },
      }));
    }
  },

  // Yangi shaxsiy suhbat yaratish + X3DH sessiyasini o'rnatish
  createChat: async (peer, token) => {
    try {
      const { id: chatId } = await chatApi.createPrivate(token, peer.id);

      // X3DH sessiya o'rnatiladi
      await tryEstablishSession(peer.id, token);

      // Yangi suhbat ob'ekti
      const newChat: Chat = {
        id:           chatId,
        type:         "private",
        title:        peer.display_name,
        peer_user_id: peer.id,
        last_message: null,
        unread_count: 0,
        updated_at:   new Date().toISOString(),
      };

      set((s) => ({
        chats:        [newChat, ...s.chats.filter((c) => c.id !== chatId)],
        activeChatId: chatId,
        userResults:  [],
      }));
    } catch (e) {
      console.error("Suhbat yaratilmadi:", e);
    }
  },

  // Xabar yuborish: E2EE → WebSocket
  sendMessage: async (chatId, recipientId, plaintext, _token) => {
    const localId = `local_${Date.now()}`;

    const tempMsg: Message = {
      id:         localId,
      chat_id:    chatId,
      sender_id:  "me",
      ciphertext: "",
      plaintext,
      msg_type:   "text",
      status:     "sending",
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] ?? []), tempMsg],
      },
    }));

    try {
      const ciphertext = await encryptMessage(chatId, recipientId, plaintext);

      // Hub kutgan format: { type: "msg.send", payload: {...} }
      wsClient.send("msg.send", {
        chat_id:       chatId,
        recipient_id:  recipientId,
        ciphertext,
        msg_type:      1,
        client_msg_id: localId,
      });

      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].map((m) =>
            m.id === localId ? { ...m, status: "sent" as const } : m
          ),
        },
      }));

      // Suhbat ro'yxatida preview yangilanadi
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                last_message: { sender_id: "me", preview: plaintext, created_at: tempMsg.created_at },
                updated_at: tempMsg.created_at,
              }
            : c
        ),
      }));
    } catch (e) {
      console.error("Xabar yuborilmadi:", e);
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].filter((m) => m.id !== localId),
        },
      }));
    }
  },

  // WebSocket hodisalari
  handleWsEvent: (event) => {
    switch (event.type) {
      case "msg.recv": {
        const m = event.payload as WsMsgRecv;
        tryDecrypt(m.chat_id, m.sender_id, m.ciphertext)
          .then((plaintext) => {
            const newMsg: Message = {
              id:         m.msg_id,
              chat_id:    m.chat_id,
              sender_id:  m.sender_id,
              ciphertext: m.ciphertext,
              plaintext,
              msg_type:   "text",
              status:     "delivered",
              created_at: new Date().toISOString(),
            };
            set((s) => ({
              messages: {
                ...s.messages,
                [m.chat_id]: [...(s.messages[m.chat_id] ?? []), newMsg],
              },
              chats: s.chats.map((c) =>
                c.id === m.chat_id
                  ? {
                      ...c,
                      last_message: { sender_id: m.sender_id, preview: plaintext, created_at: newMsg.created_at },
                      unread_count: c.unread_count + 1,
                      updated_at: newMsg.created_at,
                    }
                  : c
              ),
            }));

            // Yetkazildi tasdiqnomasi serverga qaytariladi
            wsClient.send("msg.delivered", { msg_id: m.msg_id });
          })
          .catch(() => {});
        break;
      }

      case "msg.ack": {
        // Vaqtinchalik localId → server msgId ga almashtiriladi
        const ack = event.payload as WsMsgAck;
        set((s) => {
          const updated: Record<string, Message[]> = {};
          for (const [cid, msgs] of Object.entries(s.messages)) {
            updated[cid] = msgs.map((m) =>
              m.id === ack.client_msg_id
                ? { ...m, id: ack.server_msg_id, status: "delivered" as const }
                : m
            );
          }
          return { messages: updated };
        });
        break;
      }

      case "presence": {
        const p = event.payload;
        set((s) => ({
          presenceMap: { ...s.presenceMap, [p.user_id]: p.online },
        }));
        break;
      }
    }
  },

  // Foydalanuvchi qidiruvi
  searchUsers: async (query, token) => {
    if (query.length < 2) {
      set({ userResults: [] });
      return;
    }
    set({ userLoading: true });
    try {
      const users = await userApi.search(token, query);
      set({ userResults: users ?? [], userLoading: false });
    } catch {
      set({ userResults: [], userLoading: false });
    }
  },

  clearUserResults: () => set({ userResults: [] }),
}));
