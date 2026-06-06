// Suhbatlar, xabarlar va foydalanuvchi qidiruvi holati.
//
// E2EE arxitekturasi (Signal Protocol standart):
//   birinchi xabar  → PreKeySignalMessage (Type 3): X3DH + shifrlash ichida
//   keyingi xabarlar → SignalMessage (Type 1): mavjud sessiya bilan
//
// Alohida 'key_exchange' WS event YO'Q — barcha kalit almashinuvi
// xabarning o'zi ichida yashirinadi.
// Bu offline yetkazishni ta'minlaydi: server xabarni DB ga saqlaydi.
import { create } from "zustand";
import { useAuthStore } from "@/store/authStore";
import {
  encryptMessage,
  encryptFirstMessage,
  decryptMessage,
  hasSession,
  clearSession,
  DECRYPT_ERROR_LABEL,
  classifyDecryptError,
  logDecryptError,
} from "@/crypto/adapter";
import { chatApi, keysApi, userApi, mediaApi } from "@/api/http";
import { encryptFile, parseMediaPayload, fcToB64, type MediaPayload } from "@/crypto/fileCrypto";
import { wsClient } from "@/api/ws";
import {
  persistLocalMessage,
  loadLocalMessages,
  mergeMessages,
  hydrateFromLocal,
  migrateLocalMessageId,
} from "@/storage/localHistory";
import {
  isReadablePlaintext,
  PENDING_DECRYPT_LABEL,
  MISSING_PLAINTEXT_LABEL,
} from "@/utils/messageText";
import {
  initNotifications,
  shouldNotifyIncoming,
  notifyIncomingMessage,
} from "@/utils/notifications";
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

  userResults:    User[];
  userLoading:    boolean;

  loadChats:        (token: string) => Promise<void>;
  selectChat:       (chatId: string, token: string) => Promise<void>;
  createChat:       (peer: User, token: string) => Promise<void>;
  sendMessage:      (chatId: string, recipientId: string, plaintext: string, token: string) => Promise<void>;
  sendFileMessage:  (chatId: string, recipientId: string, file: File, token: string) => Promise<void>;
  handleWsEvent:    (event: WsEvent) => void;
  searchUsers:      (query: string, token: string) => Promise<void>;
  clearUserResults: () => void;
  onAccountSwitch:  (userId: string) => void;
  resetSessionWithPeer: (chatId: string, peerId: string, token: string) => Promise<void>;
}

export { PENDING_DECRYPT_LABEL };

// ── Modul darajasidagi holat ────────────────────────────────────────────────
/** Joriy faol akkaunt (multi-account uchun) */
let activeAccountId: string | null = null;

// ── Yordamchi funksiyalar ───────────────────────────────────────────────────

function isPendingDecrypt(text: string | null | undefined): boolean {
  return text === PENDING_DECRYPT_LABEL;
}

function isDecryptFailure(text: string | null | undefined): boolean {
  return text === DECRYPT_ERROR_LABEL;
}

/** Chat ro'yxatida ko'rsatiladigan preview matn */
function previewFromMessage(msg: Message): string {
  if (msg.plaintext?.startsWith("⚠ Yuborilmadi")) return msg.plaintext;
  if (isDecryptFailure(msg.plaintext)) return DECRYPT_ERROR_LABEL;
  if (isPendingDecrypt(msg.plaintext)) return PENDING_DECRYPT_LABEL;
  // Media xabar uchun chiroyli preview
  const media = parseMediaPayload(msg.plaintext);
  if (media) {
    return media.mime_type.startsWith("image/")
      ? `🖼 ${media.file_name}`
      : `📎 ${media.file_name}`;
  }
  return msg.plaintext ?? "";
}

/**
 * Xabarni deshifrlab ochiq matn qaytaradi.
 * PreKeyMessage (Type 3): decryptMessage ichida avtomatik X3DH + decrypt.
 * SESSION_NOT_FOUND → throw qilinadi.
 */
async function decryptPlaintext(
  chatId:     string,
  senderId:   string,
  ciphertext: string,
): Promise<string> {
  if (!ciphertext?.trim()) return "";
  try {
    return await decryptMessage(chatId, senderId, ciphertext);
  } catch (e) {
    const err = classifyDecryptError(e);
    logDecryptError({ peerId: senderId, chatId }, err);
    if (err.code === "SESSION_NOT_FOUND") throw err;
    return DECRYPT_ERROR_LABEL;
  }
}

/**
 * Server tarixi uchun: mahalliy bazada topilmagan xabarni deshifrlashga urinadi.
 * Sessiya yo'q → PENDING_DECRYPT_LABEL
 * Boshqa xato → MISSING_PLAINTEXT_LABEL
 * Bu funksiya live WS xabar uchun EMAS.
 */
async function decryptForHistory(
  chatId:     string,
  senderId:   string,
  ciphertext: string,
): Promise<string> {
  try {
    return await decryptPlaintext(chatId, senderId, ciphertext);
  } catch (e) {
    const code = classifyDecryptError(e).code;
    if (code === "SESSION_NOT_FOUND") return PENDING_DECRYPT_LABEL;
    return MISSING_PLAINTEXT_LABEL;
  }
}

/** Suhbatdagi deshifrlanmagan xabarlarni qayta ochish (sessiya yangilanganida) */
async function redDecryptChatMessages(
  chatId: string,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
): Promise<void> {
  const msgs = get().messages[chatId];
  if (!msgs?.length) return;

  const updated: Message[] = [];
  for (const msg of msgs) {
    if (msg.msg_type !== "text" || !msg.ciphertext) {
      updated.push(msg);
      continue;
    }
    if (isReadablePlaintext(msg.plaintext)) {
      updated.push(msg);
      continue;
    }
    const pt = await decryptForHistory(chatId, msg.sender_id, msg.ciphertext);
    updated.push({ ...msg, plaintext: pt });
  }

  const last = updated[updated.length - 1];
  set((s) => ({
    messages: { ...s.messages, [chatId]: updated },
    chats: last
      ? s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                last_message: {
                  sender_id:  last.sender_id,
                  preview:    previewFromMessage(last),
                  created_at: last.created_at,
                },
                updated_at: last.created_at,
              }
            : c
        )
      : s.chats,
  }));

  for (const msg of updated) {
    if (isReadablePlaintext(msg.plaintext)) {
      await persistLocalMessage(msg).catch(() => {});
    }
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

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

  // Suhbat tanlanganida tarixi yuklanadi (mahalliy + server)
  selectChat: async (chatId, token) => {
    set({ activeChatId: chatId });

    const chat = get().chats.find((c) => c.id === chatId);
    const peerId = chat?.peer_user_id ?? null;

    if (peerId) {
      const sessionExists = await hasSession(peerId).catch(() => false);
      console.log(
        `[E2EE] selectChat: peer=${peerId} session=${sessionExists ? "mavjud" : "yo'q — birinchi xabarda PreKeyMessage yaratiladi"}`
      );
    }

    // 1) Mahalliy tarix — refresh dan keyin darhol ko'rinadi
    try {
      const local = await loadLocalMessages(chatId);
      if (local.length) {
        const localSorted = [...local].sort((a, b) => a.created_at.localeCompare(b.created_at));
        set((s) => ({ messages: { ...s.messages, [chatId]: localSorted } }));
        const lastLocal = localSorted[localSorted.length - 1];
        if (lastLocal.plaintext) {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    last_message: {
                      sender_id:  lastLocal.sender_id,
                      preview:    previewFromMessage(lastLocal),
                      created_at: lastLocal.created_at,
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

    // 2) Serverdan shifrlangan tarix — mahalliy ochiq matn ustun
    try {
      const local = await loadLocalMessages(chatId);
      const rawMsgs = await chatApi.history(token, chatId);

      const decrypted: Message[] = [];
      for (const msg of rawMsgs) {
        if (msg.msg_type !== "text" || !msg.ciphertext) {
          decrypted.push(msg);
          continue;
        }
        const hydrated = hydrateFromLocal(local, msg);
        if (isReadablePlaintext(hydrated.plaintext)) {
          const mp = parseMediaPayload(hydrated.plaintext);
          if (mp) {
            const mt: Message["msg_type"] = mp.mime_type.startsWith("image/") ? "image" : "file";
            decrypted.push({ ...hydrated, msg_type: mt });
          } else {
            decrypted.push(hydrated);
          }
          continue;
        }
        const pt = await decryptForHistory(chatId, msg.sender_id, msg.ciphertext);
        const mp = parseMediaPayload(pt);
        const finalType: Message["msg_type"] = mp
          ? (mp.mime_type.startsWith("image/") ? "image" : "file")
          : msg.msg_type;
        decrypted.push({ ...msg, plaintext: pt, msg_type: finalType });
      }

      const merged = mergeMessages(local, decrypted)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const last = merged[merged.length - 1];

      set((s) => ({
        messages: { ...s.messages, [chatId]: merged },
        chats: last
          ? s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    last_message: {
                      sender_id:  last.sender_id,
                      preview:    previewFromMessage(last),
                      created_at: last.created_at,
                    },
                    updated_at: last.created_at,
                  }
                : c
            )
          : s.chats,
      }));

      for (const msg of merged) {
        if (isReadablePlaintext(msg.plaintext)) {
          await persistLocalMessage(msg).catch((e) =>
            console.warn("[Chat] persistLocalMessage:", e)
          );
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
        type:         "direct",
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
      console.error("[Chat] createChat xatoligi:", e);
    }
  },

  // ── Xabar yuborish ────────────────────────────────────────────────────────
  //
  // Signal Protocol:
  //   sessiya yo'q → encryptFirstMessage (PreKeySignalMessage, Type 3)
  //                  = X3DH + shifrlash bir bosqichda
  //                  → server DB ga saqlaydi → offline yetkazish ishlaydi
  //
  //   sessiya bor  → encryptMessage (SignalMessage, Type 1)
  //
  // Alohida 'key_exchange' WS event YO'Q.
  sendMessage: async (chatId, recipientId, plaintext, token) => {
    const localId = `local_${Date.now()}`;
    const now     = new Date().toISOString();

    const tempMsg: Message = {
      id:         localId,
      chat_id:    chatId,
      sender_id:  "me",
      ciphertext: "",
      plaintext,
      msg_type:   "text",
      status:     "sending",
      created_at: now,
    };

    // UI'da darhol ko'rinadi
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] ?? []), tempMsg],
      },
    }));

    try {
      const sessionExists = await hasSession(recipientId).catch(() => false);
      let ciphertext: string;
      let msgTypeNum: number;

      if (!sessionExists) {
        // ── Sessiya yo'q: PreKeyMessage (X3DH + shifrlash inline) ──────────
        console.log(`[E2EE] 🔑 PreKeyMessage → ${recipientId} (sessiya yangi)`);
        const bundle = await keysApi.getBundle(token, recipientId);
        ciphertext = await encryptFirstMessage(
          chatId,
          recipientId,
          JSON.stringify(bundle),
          plaintext,
        );
        msgTypeNum = 3; // PreKeySignalMessage
      } else {
        // ── Sessiya mavjud: oddiy SignalMessage ────────────────────────────
        ciphertext = await encryptMessage(chatId, recipientId, plaintext);
        msgTypeNum = 1;
      }

      wsClient.send("msg.send", {
        chat_id:       chatId,
        recipient_id:  recipientId,
        ciphertext,
        msg_type:      msgTypeNum,
        client_msg_id: localId,
      });

      const sentMsg: Message = { ...tempMsg, ciphertext, status: "sent" };

      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((m) =>
            m.id === localId ? sentMsg : m
          ),
        },
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                last_message: { sender_id: "me", preview: plaintext, created_at: now },
                updated_at:   now,
              }
            : c
        ),
      }));

      await persistLocalMessage(sentMsg).catch(() => {});

    } catch (e) {
      console.error("[E2EE] sendMessage xatoligi:", e);
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((m) =>
            m.id === localId
              ? {
                  ...m,
                  status:   "sent" as const,
                  plaintext: `⚠ Yuborilmadi: ${e instanceof Error ? e.message : String(e)}`,
                }
              : m
          ),
        },
      }));
    }
  },

  // ── Fayl / rasm yuborish ──────────────────────────────────────────────────
  //
  // 1. Client: fayl AES-256-GCM bilan shifrlanadi.
  // 2. Client: shifrlangan blob Go serverga POST /api/v1/upload bilan yuklanadi.
  // 3. Server: faylni /uploads/{uuid} ga saqlaydi, URL qaytaradi.
  // 4. Client: { url, aes_key, iv, file_name, mime_type, size } JSON Signal bilan shifrlanadi.
  // 5. Server: ciphertext-ni DB ga saqlaydi (hech narsani bilmaydi).
  // 6. Qabul qiluvchi: Signal deshifrlaydi → JSON → AES kalit bilan faylni deshifrlaydi.
  sendFileMessage: async (chatId, recipientId, file, token) => {
    const localId = `local_${Date.now()}`;
    const now     = new Date().toISOString();
    const isImage = file.type.startsWith("image/");
    // "image" yoki "file" — MessageBubble shu qiymatga tayanadi
    const mediaType: Message["msg_type"] = isImage ? "image" : "file";
    const displayPreview = isImage ? `🖼 ${file.name}` : `📎 ${file.name}`;

    // UI'da "yuklanmoqda" holati
    const tempMsg: Message = {
      id:         localId,
      chat_id:    chatId,
      sender_id:  "me",
      ciphertext: "",
      plaintext:  `⏳ ${displayPreview}`,
      msg_type:   mediaType,
      status:     "sending",
      created_at: now,
    };
    set((s) => ({
      messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), tempMsg] },
    }));

    try {
      // 1) AES-256-GCM bilan faylni shifrlash
      const { blob: encBlob, key, iv, mimeType, fileName, size } = await encryptFile(file);
      console.log(`[Media] 🔒 Shifrlandi: ${fileName} ${size}B`);

      // 2) Shifrlangan blob'ni serverga yuklash
      const { url } = await mediaApi.uploadFile(token, encBlob);
      console.log(`[Media] ⬆ Yuklandi: ${url}`);

      // 3) AES kalit + IV JSON payload ichida Signal bilan shifrlash
      const payload: MediaPayload = {
        url,
        aes_key:   fcToB64(key),
        iv:        fcToB64(iv),
        file_name: fileName,
        mime_type: mimeType,
        size,
      };
      const plaintext = JSON.stringify(payload);

      // 4) Signal Protocol: sessiya bor → SignalMessage, yo'q → PreKeyMessage
      const sessionExists = await hasSession(recipientId).catch(() => false);
      let ciphertext: string;
      let msgTypeNum: number;

      if (!sessionExists) {
        console.log(`[E2EE] 🔑 Media PreKeyMessage → ${recipientId}`);
        const bundle = await keysApi.getBundle(token, recipientId);
        ciphertext = await encryptFirstMessage(chatId, recipientId, JSON.stringify(bundle), plaintext);
        msgTypeNum = 3;
      } else {
        ciphertext = await encryptMessage(chatId, recipientId, plaintext);
        msgTypeNum = 1;
      }

      wsClient.send("msg.send", {
        chat_id:       chatId,
        recipient_id:  recipientId,
        ciphertext,
        msg_type:      msgTypeNum,
        client_msg_id: localId,
      });

      const sentMsg: Message = {
        ...tempMsg,
        ciphertext,
        plaintext,
        msg_type: mediaType,  // "image" yoki "file"
        status:   "sent",
      };

      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((m) => m.id === localId ? sentMsg : m),
        },
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                last_message: { sender_id: "me", preview: displayPreview, created_at: now },
                updated_at:   now,
              }
            : c
        ),
      }));

      await persistLocalMessage(sentMsg).catch(() => {});
      console.log(`[Media] ✅ Yuborildi: ${fileName}`);

    } catch (e) {
      console.error("[Media] sendFileMessage xatoligi:", e);
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((m) =>
            m.id === localId
              ? { ...m, status: "sent" as const, plaintext: `⚠ Yuborilmadi: ${e instanceof Error ? e.message : String(e)}` }
              : m
          ),
        },
      }));
    }
  },

  // ── WebSocket hodisalari ──────────────────────────────────────────────────
  handleWsEvent: (event) => {
    const authUserId = useAuthStore.getState().userId;
    if (!authUserId) return;
    if (activeAccountId !== authUserId) activeAccountId = authUserId;

    switch (event.type) {

      case "msg.recv": {
        const m = event.payload as WsMsgRecv;
        console.log(`[WS] msg.recv: from=${m.sender_id} chat=${m.chat_id} id=${m.msg_id} type=${m.msg_type}`);

        void (async () => {
          // Takroriy xabar tekshiruvi
          if (get().messages[m.chat_id]?.some((x) => x.id === m.msg_id)) {
            console.log(`[WS] msg.recv: takroriy xabar id=${m.msg_id}`);
            return;
          }

          // ── E2EE: BIR MARTA deshifrlash ──────────────────────────────────
          // decryptMessage ichida PreKeyMessage (Type 3) avtomatik aniqlaydi:
          //   1. X3DH sessiyasini o'rnatadi
          //   2. Ichki xabarni deshifrlaydi
          // Oddiy xabar (Type 1): mavjud sessiya bilan deshifrlaydi.
          let plaintext: string;
          try {
            plaintext = await decryptMessage(m.chat_id, m.sender_id, m.ciphertext);
            console.log(`[WS] ✅ Deshifrlandi: id=${m.msg_id} len=${plaintext.length}`);
          } catch (e) {
            const err = classifyDecryptError(e);
            console.warn(`[WS] ❌ Deshifrlash xatosi: id=${m.msg_id} code=${err.code}`);
            // SESSION_NOT_FOUND: sessiya yo'q (Type 1 message, eski sessiya)
            // Boshqa xato: noto'g'ri kalit yoki buzilgan xabar
            plaintext =
              err.code === "SESSION_NOT_FOUND"
                ? PENDING_DECRYPT_LABEL
                : DECRYPT_ERROR_LABEL;
          }

          // Media xabar ekanligini deshifrlangan plaintext JSON'dan aniqlaymiz
          // msg_type: "image" | "file" | "text" — MessageBubble shu qiymatga tayanadi
          const mediaP = parseMediaPayload(plaintext);
          const detectedType: Message["msg_type"] = mediaP
            ? (mediaP.mime_type.startsWith("image/") ? "image" : "file")
            : "text";
          const newMsg: Message = {
            id:         m.msg_id,
            chat_id:    m.chat_id,
            sender_id:  m.sender_id,
            ciphertext: m.ciphertext,
            plaintext,
            msg_type:   detectedType,
            status:     "delivered",
            created_at: new Date().toISOString(),
          };

          // ── Ochiq matnni mahalliy bazaga saqlash (qayta deshifrlashni oldini olish) ──
          if (isReadablePlaintext(plaintext)) {
            try {
              await persistLocalMessage(newMsg);
              console.log(`[WS] 💾 Saqlandi: id=${m.msg_id}`);
            } catch (e) {
              console.error("[WS] persistLocalMessage xatoligi (davom etadi):", e);
            }
          }

          // ── Store / UI yangilash ──────────────────────────────────────────
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
                      sender_id:  m.sender_id,
                      preview:    previewFromMessage(newMsg),
                      created_at: newMsg.created_at,
                    },
                    unread_count:
                      c.id === get().activeChatId
                        ? c.unread_count
                        : c.unread_count + 1,
                    updated_at: newMsg.created_at,
                  }
                : c
            ),
          }));

          // ── Tauri OS bildirishnomasi ──────────────────────────────────────
          if (isReadablePlaintext(plaintext)) {
            const chat         = get().chats.find((c) => c.id === m.chat_id);
            const notifyText   = mediaP
              ? (mediaP.mime_type.startsWith("image/") ? `🖼 ${mediaP.file_name}` : `📎 ${mediaP.file_name}`)
              : plaintext;
            const show = await shouldNotifyIncoming(m.chat_id, get().activeChatId);
            if (show) {
              await notifyIncomingMessage(
                chat?.title ?? m.sender_id,
                notifyText,
                m.chat_id,
              );
            }
          }

          wsClient.send("msg.delivered", { msg_id: m.msg_id });
        })();
        break;
      }

      case "msg.ack": {
        const ack = event.payload as WsMsgAck;
        console.log(`[WS] msg.ack: client=${ack.client_msg_id} → server=${ack.server_msg_id}`);

        let ackMsg: Message | undefined;
        for (const msgs of Object.values(get().messages)) {
          const hit = msgs.find((m) => m.id === ack.client_msg_id);
          if (hit) {
            ackMsg = { ...hit, id: ack.server_msg_id, status: "delivered" };
            break;
          }
        }

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

        if (ackMsg && isReadablePlaintext(ackMsg.plaintext)) {
          void migrateLocalMessageId(ack.client_msg_id, ackMsg).catch((e) =>
            console.warn("[WS] migrateLocalMessageId:", e)
          );
        }
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

  // ── Akkaunt almashinuvi ───────────────────────────────────────────────────
  onAccountSwitch: (userId) => {
    activeAccountId = userId;
    set({
      chats:        [],
      messages:     {},
      activeChatId: null,
      presenceMap:  {},
      userResults:  [],
    });
    void initNotifications();
    console.log(`[Chat] onAccountSwitch: ${userId}, state tozalandi`);
  },

  // ── Sessiyani qayta tiklash ───────────────────────────────────────────────
  //
  // Sessiya tozalanadi. Keyingi xabarda sendMessage avtomatik PreKeyMessage
  // yaratadi — alohida 'session.rekey_request' WS event kerak emas.
  resetSessionWithPeer: async (chatId, peerId, _token) => {
    console.log(`[E2EE] Sessiyani qayta tiklash: peer=${peerId}`);
    await clearSession(peerId);

    // UI'dagi xato xabarlarni "qayta tiklandi" belgisi bilan almashtirish
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) =>
          !isReadablePlaintext(m.plaintext)
            ? {
                ...m,
                plaintext: "🔄 Sessiya tiklandi. Yangi xabar yuborib ko'ring.",
              }
            : m
        ),
      },
    }));

    // Sessiya o'rnatilsa ham qayta ko'rsatish uchun
    await redDecryptChatMessages(chatId, set, get);

    console.log(`[E2EE] ✅ Sessiya tozalandi. Keyingi xabarda PreKeyMessage yaratiladi.`);
  },
}));

// ── Permanent WS handler ──────────────────────────────────────────────────────
// ChatList.tsx ga bog'liq emas — modul import paytida bir marta ro'yxatdan o'tadi.
wsClient.on((event) => useChatStore.getState().handleWsEvent(event));
