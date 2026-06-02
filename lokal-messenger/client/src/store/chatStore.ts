// Suhbatlar, xabarlar va foydalanuvchi qidiruvi holati.
// E2EE oqimi: establish_session → key_exchange WS → establish_session_receiver → encrypt/decrypt
import { create } from "zustand";
import {
  encryptMessage,
  decryptMessage,
  establishSession,
  establishSessionReceiver,
  hasSession,
  DECRYPT_ERROR_LABEL,
} from "@/crypto/adapter";
import { chatApi, keysApi, userApi } from "@/api/http";
import { wsClient } from "@/api/ws";
import {
  persistLocalMessage,
  loadLocalMessages,
  mergeMessages,
} from "@/storage/localHistory";
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

/** Xabarni deshifrlab ochiq matn qaytaradi; xato bo'lsa DECRYPT_ERROR_LABEL */
async function decryptPlaintext(
  chatId:     string,
  senderId:   string,
  ciphertext: string
): Promise<string> {
  if (!ciphertext?.trim()) return "";
  try {
    return await decryptMessage(chatId, senderId, ciphertext);
  } catch (e) {
    console.error(`[E2EE] decrypt xatoligi (${senderId}):`, e);
    return DECRYPT_ERROR_LABEL;
  }
}

function isDecryptFailure(text: string | null): boolean {
  return text === DECRYPT_ERROR_LABEL;
}

/** Xabardan chat ro'yxati preview matnini hosil qiladi */
function previewFromMessage(msg: Message): string {
  if (msg.plaintext?.startsWith("⚠ Yuborilmadi")) return msg.plaintext;
  if (isDecryptFailure(msg.plaintext)) return DECRYPT_ERROR_LABEL;
  return msg.plaintext ?? "";
}

/** Suhbatdagi deshifrlanmagan / xato xabarlarni qayta ochish */
async function redDecryptChatMessages(
  chatId: string,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): Promise<void> {
  const msgs = get().messages[chatId];
  if (!msgs?.length) return;

  const updated = await Promise.all(
    msgs.map(async (msg) => {
      if (msg.msg_type !== "text" || !msg.ciphertext) return msg;
      if (msg.plaintext && !isDecryptFailure(msg.plaintext)) return msg;
      return { ...msg, plaintext: await decryptPlaintext(chatId, msg.sender_id, msg.ciphertext) };
    })
  );

  const last = updated[updated.length - 1];
  set((s) => ({
    messages: { ...s.messages, [chatId]: updated },
    chats: last
      ? s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                last_message: {
                  sender_id: last.sender_id,
                  preview:     previewFromMessage(last),
                  created_at:  last.created_at,
                },
                updated_at: last.created_at,
              }
            : c
        )
      : s.chats,
  }));

  for (const msg of updated) {
    if (!isDecryptFailure(msg.plaintext)) {
      await persistLocalMessage(msg).catch(() => {});
    }
  }
}

// Sherik kalit bundle'ini fetch qilib X3DH sessiya o'rnatish
// Returns: EstablishResult yoki null (xatolik bo'lsa)
async function tryEstablishSenderSession(
  peerId: string,
  token:  string
) {
  // 1. Bundle olish
  let bundle;
  try {
    bundle = await keysApi.getBundle(token, peerId);
    console.log(`[X3DH] Bundle olindi (${peerId}):`, {
      identity_key:   bundle.identity_key?.slice(0, 12) + "…",
      spk_key_id:     bundle.signed_prekey?.key_id,
      has_otpk:       !!bundle.one_time_prekey,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) {
      console.error(`[X3DH] ❌ ${peerId} uchun kalit bundle server'da yo'q (HTTP 404).`
        + ` Peer login qilganda kalitlarini yuklamagandir yoki server DB tozalangan.`);
    } else {
      console.error(`[X3DH] ❌ Bundle olishda xatolik (${peerId}):`, msg);
    }
    return null;
  }

  // 2. X3DH sessiya o'rnatish
  try {
    const result = await establishSession(peerId, JSON.stringify(bundle));
    console.log(`[X3DH] ✅ Sessiya o'rnatildi (sender): ${peerId}`);
    return result;
  } catch (e) {
    console.error(`[X3DH] ❌ establish_session xatoligi (${peerId}):`, e);
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

    const chat = get().chats.find((c) => c.id === chatId);
    const peerId = chat?.peer_user_id ?? null;

    // Sessiya yo'q bo'lsagina o'rnatamiz (mavjud sessiyani qayta yozmaslik uchun)
    if (peerId) {
      const sessionExists = await hasSession(peerId).catch(() => false);
      if (!sessionExists) {
        console.log(`[X3DH] selectChat: sessiya yo'q, o'rnatilmoqda → ${peerId}`);
        const result = await tryEstablishSenderSession(peerId, token);
        if (result) {
          sendKeyExchangeWs(chatId, peerId, result.ekPk, result.senderIkX25519, result.spkKeyId, result.otpkKeyId);
        }
      } else {
        console.log(`[X3DH] selectChat: sessiya mavjud → ${peerId}`);
      }
    }

    // 1) Mahalliy tarix — refresh dan keyin darhol ko'rinadi
    try {
      const local = await loadLocalMessages(chatId);
      if (local.length) {
        set((s) => ({ messages: { ...s.messages, [chatId]: local } }));
        const lastLocal = local[local.length - 1];
        if (lastLocal.plaintext) {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    last_message: {
                      sender_id: lastLocal.sender_id,
                      preview:     previewFromMessage(lastLocal),
                      created_at:  lastLocal.created_at,
                    },
                    updated_at: lastLocal.created_at,
                  }
                : c
            ),
          }));
        }
      }
    } catch (e) {
      console.warn("[Chat] mahalliy tarix o'qilmadi:", e);
    }

    // 2) Serverdan shifrlangan tarix + deshifrlash + birlashtirish
    try {
      const local = await loadLocalMessages(chatId);
      const rawMsgs = await chatApi.history(token, chatId);
      const decrypted = await Promise.all(
        rawMsgs.map(async (msg) => {
          if (msg.msg_type === "text" && msg.ciphertext) {
            const localHit = local.find((l) => l.id === msg.id && l.plaintext && !isDecryptFailure(l.plaintext));
            if (localHit) return localHit;
            return { ...msg, plaintext: await decryptPlaintext(chatId, msg.sender_id, msg.ciphertext) };
          }
          return msg;
        })
      );
      const merged = mergeMessages(local, decrypted);
      const last = merged[merged.length - 1];

      set((s) => ({
        messages: { ...s.messages, [chatId]: merged },
        chats: last
          ? s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    last_message: {
                      sender_id: last.sender_id,
                      preview:     previewFromMessage(last),
                      created_at:  last.created_at,
                    },
                    updated_at: last.created_at,
                  }
                : c
            )
          : s.chats,
      }));

      for (const msg of merged) {
        if (!isDecryptFailure(msg.plaintext)) {
          await persistLocalMessage(msg).catch(() => {});
        }
      }
    } catch (e) {
      console.error("[Chat] server tarixi yuklanmadi:", e);
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

      // X3DH sessiya o'rnatish — faqat yo'q bo'lsa (yangi chat)
      const sessionExists = await hasSession(peer.id).catch(() => false);
      if (!sessionExists) {
        const result = await tryEstablishSenderSession(peer.id, token);
        if (result) {
          sendKeyExchangeWs(chatId, peer.id, result.ekPk, result.senderIkX25519, result.spkKeyId, result.otpkKeyId);
        }
      }
    } catch (e) {
      console.error("[Chat] createChat xatoligi:", e);
    }
  },

  // Xabar yuborish: E2EE → WebSocket
  sendMessage: async (chatId, recipientId, plaintext, token) => {
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

    // ── X3DH avtomatik ta'minlash ──────────────────────────────────────────
    // Har xabar yuborishdan oldin sessiyani tekshiramiz.
    // Yo'q bo'lsa, X3DH o'rnatib key_exchange yuborib, keyin shifrlaymiz.
    try {
      const sessionExists = await hasSession(recipientId).catch(() => false);
      if (!sessionExists) {
        console.log(`[X3DH] sendMessage: sessiya yo'q (${recipientId}), X3DH boshlanmoqda…`);
        const result = await tryEstablishSenderSession(recipientId, token);
        if (!result) {
          throw new Error("X3DH muvaffaqiyatsiz: peer kalit to'plamini ololmadi yoki sessiya o'rnatilmadi");
        }
        sendKeyExchangeWs(chatId, recipientId, result.ekPk, result.senderIkX25519, result.spkKeyId, result.otpkKeyId);
        // Qabul qiluvchi key_exchange ni qayta ishlashi uchun qisqa kutish
        await new Promise<void>((res) => setTimeout(res, 300));
        console.log(`[X3DH] sendMessage: sessiya o'rnatildi → ${recipientId}`);
      }
    } catch (setupErr) {
      console.error("[X3DH] Sessiya o'rnatishda xatolik:", setupErr);
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].map((m) =>
            m.id === localId
              ? { ...m, status: "sent" as const, plaintext: `⚠ Yuborilmadi: ${setupErr instanceof Error ? setupErr.message : String(setupErr)}` }
              : m
          ),
        },
      }));
      return;
    }
    // ──────────────────────────────────────────────────────────────────────

    try {
      const ciphertext = await encryptMessage(chatId, recipientId, plaintext);

      wsClient.send("msg.send", {
        chat_id:       chatId,
        recipient_id:  recipientId,
        ciphertext,
        msg_type:      1,
        client_msg_id: localId,
      });

      const sentMsg: Message = {
        ...tempMsg,
        ciphertext,
        status: "sent",
      };

      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: s.messages[chatId].map((m) =>
            m.id === localId ? sentMsg : m
          ),
        },
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, last_message: { sender_id: "me", preview: plaintext, created_at: tempMsg.created_at }, updated_at: tempMsg.created_at }
            : c
        ),
      }));

      await persistLocalMessage(sentMsg).catch(() => {});
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

        void (async () => {
          const plaintext = await decryptPlaintext(m.chat_id, m.sender_id, m.ciphertext);
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

          const dup = get().messages[m.chat_id]?.some((x) => x.id === m.msg_id);
          if (dup) return;

          set((s) => ({
            messages: {
              ...s.messages,
              [m.chat_id]: [...(s.messages[m.chat_id] ?? []), newMsg],
            },
            chats: s.chats.map((c) =>
              c.id === m.chat_id
                ? {
                    ...c,
                    last_message: {
                      sender_id: m.sender_id,
                      preview:     previewFromMessage(newMsg),
                      created_at:  newMsg.created_at,
                    },
                    unread_count: c.id === get().activeChatId ? c.unread_count : c.unread_count + 1,
                    updated_at:   newMsg.created_at,
                  }
                : c
            ),
          }));
          if (!isDecryptFailure(plaintext)) {
            await persistLocalMessage(newMsg).catch(() => {});
          }
          wsClient.send("msg.delivered", { msg_id: m.msg_id });
        })();
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
        // Mahalliy bazada id yangilanishi
        for (const msgs of Object.values(get().messages)) {
          const hit = msgs.find((m) => m.id === ack.server_msg_id);
          if (hit?.plaintext && !isDecryptFailure(hit.plaintext)) {
            void persistLocalMessage(hit).catch(() => {});
            break;
          }
        }
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
          .then(async () => {
            console.log(`[X3DH] Qabul qiluvchi sessiya o'rnatildi: ${ke.sender_id}`);

            // Sessiya o'rnatilgach — oldingi deshifrlanmagan xabarlarni qayta ochish
            await redDecryptChatMessages(ke.chat_id, set, get);

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
