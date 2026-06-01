// Suhbatlar va xabarlar holati. E2EE ochilgandan keyingi matn saqlanadi.
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { chatApi } from "@/api/http";
import { wsClient } from "@/api/ws";
import type { Chat, Message, WsEvent, WsMessage } from "@/types";

interface ChatState {
  chats:        Chat[];
  activeChatId: string | null;
  messages:     Record<string, Message[]>;
  presenceMap:  Record<string, boolean>;
  loading:      boolean;

  loadChats:      (token: string) => Promise<void>;
  selectChat:     (chatId: string, token: string) => Promise<void>;
  sendMessage:    (chatId: string, recipientId: string, plaintext: string, token: string) => Promise<void>;
  handleWsEvent:  (event: WsEvent) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats:        [],
  activeChatId: null,
  messages:     {},
  presenceMap:  {},
  loading:      false,

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

  // Suhbat tanlanganida xabar tarixi yuklanadi va E2EE shifrdan ochiladi
  selectChat: async (chatId, _token) => {
    set({ activeChatId: chatId });
    const existing = get().messages[chatId];
    if (existing?.length) return;

    const raw = await chatApi.history(_token, chatId);

    // Har bir xabarning ciphertext'i Rust backend orqali ochiladi
    const decrypted = await Promise.all(
      raw.map(async (msg) => {
        if (msg.msg_type === "text") {
          try {
            const plaintext = await invoke<string>("decrypt_message", {
              chatId,
              senderId:   msg.sender_id,
              ciphertext: msg.ciphertext,
            });
            return { ...msg, plaintext };
          } catch {
            return { ...msg, plaintext: "[shifr ochilmadi]" };
          }
        }
        return { ...msg, plaintext: null };
      })
    );

    set((s) => ({
      messages: { ...s.messages, [chatId]: decrypted },
    }));
  },

  // Xabar yuborishdan oldin Rust backend orqali shifrlanadi
  sendMessage: async (chatId, recipientId, plaintext, _token) => {
    const localId = `local_${Date.now()}`;

    // UI da "yuborilmoqda" holati darhol ko'rsatiladi (optimistic update)
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
      // Xabar Rust E2EE qatlami orqali shifrlanadi
      const ciphertext = await invoke<string>("encrypt_message", {
        chatId,
        recipientId,
        plaintext,
      });

      // Shifrlangan payload WebSocket orqali serverga yuboriladi
      wsClient.send({
        type:         "message",
        chat_id:      chatId,
        recipient_id: recipientId,
        ciphertext,
        msg_type:     "text",
      });

      // Vaqtinchalik xabar holati "sent" ga o'zgartiriladi
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].map((m) =>
            m.id === localId ? { ...m, status: "sent" as const } : m
          ),
        },
      }));
    } catch {
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].filter((m) => m.id !== localId),
        },
      }));
    }
  },

  // WebSocket hodisalari: yangi xabar, haضur holati, o'qish tasdigi
  handleWsEvent: (event) => {
    switch (event.type) {
      case "message": {
        const m = event.payload as WsMessage;
        // Kiruvchi xabar E2EE dan ochiladi va suhbat ro'yxatiga qo'shiladi
        invoke<string>("decrypt_message", {
          chatId:     m.chat_id,
          senderId:   m.sender_id,
          ciphertext: m.ciphertext,
        })
          .then((plaintext) => {
            const newMsg: Message = {
              id:         m.id,
              chat_id:    m.chat_id,
              sender_id:  m.sender_id,
              ciphertext: m.ciphertext,
              plaintext,
              msg_type:   m.msg_type as Message["msg_type"],
              status:     "delivered",
              created_at: m.created_at,
            };
            set((s) => ({
              messages: {
                ...s.messages,
                [m.chat_id]: [...(s.messages[m.chat_id] ?? []), newMsg],
              },
            }));
          })
          .catch(() => {});
        break;
      }

      case "presence": {
        const p = event.payload;
        set((s) => ({
          presenceMap: { ...s.presenceMap, [p.user_id]: p.online },
        }));
        break;
      }

      case "read_receipt": {
        const r = event.payload;
        set((s) => ({
          messages: {
            ...s.messages,
            [r.chat_id]: (s.messages[r.chat_id] ?? []).map((m) =>
              m.id === r.message_id ? { ...m, status: "read" as const } : m
            ),
          },
        }));
        break;
      }
    }
  },
}));
