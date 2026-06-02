// Suhbatlar, xabarlar va foydalanuvchi qidiruvi holati.
// E2EE oqimi: establish_session → key_exchange WS → establish_session_receiver → encrypt/decrypt
import { create } from "zustand";
import {
  encryptMessage,
  decryptMessage,
  establishSession,
  establishSessionReceiver,
} from "@/crypto/adapter";
import { chatApi, keysApi, userApi } from "@/api/http";
import { wsClient } from "@/api/ws";
import type {
  Chat, Message, User,
  WsEvent, WsMsgRecv, WsMsgAck, WsKeyExchange,
} from "@/types";

interface ChatState {
  chats:        Chat[];
  activeChatId: string | null;
  messages:     Record<string, Message[]>;
  presenceMap:  Record<string, boolean>;
  loading:      boolean;

  userResults:    User[];
  userLoading:    boolean;

  loadChats:        (token: string) => Promise<void>;
  selectChat:       (chatId: string, token: string) => Promise<void>;
  createChat:       (peer: User, token: string) => Promise<void>;
  sendMessage:      (chatId: string, recipientId: string, plaintext: string, token: string) => Promise<void>;
  handleWsEvent:    (event: WsEvent) => void;
  searchUsers:      (query: string, token: string) => Promise<void>;
  clearUserResults: () => void;
}

// Xavfsiz decrypt — sessiya yo'q bo'lsa fallback
async function tryDecrypt(
  chatId:     string,
  senderId:   string,
  ciphertext: string
): Promise<string> {
  if (!ciphertext) return "";
  try {
    return await decryptMessage(chatId, senderId, ciphertext);
  } catch (e) {
    console.warn(`[E2EE] decrypt xatoligi (${senderId}):`, e);
    return "[Shifrlangan xabar]";
  }
}

// Sherik kalit bundle'ini fetch qilib X3DH sessiya o'rnatish
// Returns: EstablishResult yoki null (server'da kalit yo'q bo'lsa)
async function tryEstablishSenderSession(
  peerId: string,
  token:  string
) {
  try {
    const bundle = await keysApi.getBundle(token, peerId);
    const result = await establishSession(peerId, JSON.stringify(bundle));
    console.log(`[X3DH] Sessiya o'rnatildi (sender): ${peerId}`, result);
    return result;
  } catch (e) {
    console.warn(`[X3DH] establish_session muvaffaqiyatsiz (${peerId}):`, e);
    return null;
  }
}

// Key_exchange WS xabari yuborish
function sendKeyExchangeWs(
  chatId:      string,
  recipientId: string,
  ekPk:        string,
  senderIkX25519: string,
  spkKeyId:    number,
  otpkKeyId:   number
): void {
  wsClient.send("key_exchange", {
    chat_id:          chatId,
    recipient_id:     recipientId,
    ek_pk:            ekPk,
    sender_ik_x25519: senderIkX25519,
    spk_key_id:       spkKeyId,
    otpk_key_id:      otpkKeyId,
  });
  console.log(`[X3DH] key_exchange WS yuborildi → ${recipientId}`);
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
    } catch (e) {
      console.error("[Chat] loadChats xatoligi:", e);
      set({ loading: false });
    }
  },

  // Suhbat tanlanganida tarixi yuklanadi
  selectChat: async (chatId, token) => {
    set({ activeChatId: chatId });

    const existing = get().messages[chatId];
    if (existing?.length) return;

    const chat = get().chats.find((c) => c.id === chatId);
    const peerId = chat?.peer_user_id ?? null;

    // Sessiya mavjud emas bo'lsa sender side sessiya o'rnatib key_exchange yuboramiz
    if (peerId) {
      const result = await tryEstablishSenderSession(peerId, token);
      if (result) {
        sendKeyExchangeWs(chatId, peerId, result.ekPk, result.senderIkX25519, result.spkKeyId, result.otpkKeyId);
      }
    }

    try {
      const rawMsgs = await chatApi.history(token, chatId);
      const decrypted = await Promise.all(
        rawMsgs.map(async (msg) => {
          if (msg.msg_type === "text" && msg.ciphertext) {
            return { ...msg, plaintext: await tryDecrypt(chatId, msg.sender_id, msg.ciphertext) };
          }
          return { ...msg, plaintext: null };
        })
      );
      set((s) => ({ messages: { ...s.messages, [chatId]: decrypted } }));
    } catch (e) {
      console.error("[Chat] history yuklanmadi:", e);
      set((s) => ({ messages: { ...s.messages, [chatId]: [] } }));
    }
  },

  // Yangi shaxsiy suhbat yaratish
  createChat: async (peer, token) => {
    try {
      const { id: chatId } = await chatApi.createPrivate(token, peer.id);

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

      // X3DH sessiya o'rnatish + key_exchange WS
      const result = await tryEstablishSenderSession(peer.id, token);
      if (result) {
        sendKeyExchangeWs(chatId, peer.id, result.ekPk, result.senderIkX25519, result.spkKeyId, result.otpkKeyId);
      }
    } catch (e) {
      console.error("[Chat] createChat xatoligi:", e);
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
      messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), tempMsg] },
    }));

    try {
      const ciphertext = await encryptMessage(chatId, recipientId, plaintext);

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
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, last_message: { sender_id: "me", preview: plaintext, created_at: tempMsg.created_at }, updated_at: tempMsg.created_at }
            : c
        ),
      }));
    } catch (e) {
      console.error("[E2EE] sendMessage xatoligi:", e);
      // Xatolik xabarini UI da ko'rsatish
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].map((m) =>
            m.id === localId
              ? { ...m, status: "sent" as const, plaintext: `⚠ Yuborilmadi: ${e instanceof Error ? e.message : String(e)}` }
              : m
          ),
        },
      }));
    }
  },

  // WebSocket hodisalari
  handleWsEvent: (event) => {
    switch (event.type) {
      case "msg.recv": {
        const m = event.payload as WsMsgRecv;
        console.log(`[WS] msg.recv: from=${m.sender_id} chat=${m.chat_id}`);
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
                  ? { ...c, last_message: { sender_id: m.sender_id, preview: plaintext, created_at: newMsg.created_at }, unread_count: c.unread_count + 1 }
                  : c
              ),
            }));
            wsClient.send("msg.delivered", { msg_id: m.msg_id });
          })
          .catch((e) => console.error("[E2EE] handleWsEvent decrypt xatoligi:", e));
        break;
      }

      case "msg.ack": {
        const ack = event.payload as WsMsgAck;
        console.log(`[WS] msg.ack: client=${ack.client_msg_id} → server=${ack.server_msg_id}`);
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

      case "key_exchange": {
        const ke = event.payload as WsKeyExchange;
        console.log(`[X3DH] key_exchange keldi: from=${ke.sender_id} chat=${ke.chat_id}`);

        // Qabul qiluvchi tomoni X3DH sessiyasini o'rnatadi
        establishSessionReceiver(
          ke.sender_id,
          ke.ek_pk,
          ke.sender_ik_x25519,
          ke.spk_key_id,
          ke.otpk_key_id
        )
          .then(() => {
            console.log(`[X3DH] Qabul qiluvchi sessiya o'rnatildi: ${ke.sender_id}`);

            // Agar bu suhbat xabarlari "[Shifrlangan xabar]" ko'rsatayotgan bo'lsa, qayta decrypt
            const msgs = get().messages[ke.chat_id];
            if (msgs?.length) {
              Promise.all(
                msgs.map(async (msg) => {
                  if (msg.plaintext === "[Shifrlangan xabar]" && msg.ciphertext) {
                    return { ...msg, plaintext: await tryDecrypt(ke.chat_id, msg.sender_id, msg.ciphertext) };
                  }
                  return msg;
                })
              ).then((updated) => {
                set((s) => ({ messages: { ...s.messages, [ke.chat_id]: updated } }));
              }).catch(() => {});
            }

            // Ushbu suhbat uchun chat_id topib birinchi suhbatni chatlar ro'yxatiga qo'shamiz
            const existingChat = get().chats.find((c) => c.id === ke.chat_id);
            if (!existingChat) {
              // Yangi suhbat: state'ga qo'shamiz (foydalanuvchi ma'lumoti keyinroq to'ldiriladi)
              const newChat: Chat = {
                id:           ke.chat_id,
                type:         "private",
                title:        ke.sender_id,   // vaqtinchalik — username
                peer_user_id: ke.sender_id,
                last_message: null,
                unread_count: 0,
                updated_at:   new Date().toISOString(),
              };
              set((s) => ({ chats: [newChat, ...s.chats] }));
            }
          })
          .catch((e) => console.error("[X3DH] establish_session_receiver xatoligi:", e));
        break;
      }

      case "presence": {
        const p = event.payload;
        set((s) => ({ presenceMap: { ...s.presenceMap, [p.user_id]: p.online } }));
        break;
      }
    }
  },

  // Foydalanuvchi qidiruvi
  searchUsers: async (query, token) => {
    if (query.length < 2) { set({ userResults: [] }); return; }
    set({ userLoading: true });
    try {
      const users = await userApi.search(token, query);
      set({ userResults: users ?? [], userLoading: false });
    } catch (e) {
      console.error("[Search] searchUsers xatoligi:", e);
      set({ userResults: [], userLoading: false });
    }
  },

  clearUserResults: () => set({ userResults: [] }),
}));
