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
import { normalizePayload } from "@/crypto/webCrypto";
import { chatApi, keysApi, userApi, mediaApi } from "@/api/http";
import { encryptFile, parseMediaPayload, fcToB64, type MediaPayload } from "@/crypto/fileCrypto";
import { wsClient } from "@/api/ws";
import {
  persistLocalMessage,
  loadLocalMessages,
  mergeMessages,
  hydrateFromLocal,
  migrateLocalMessageId,
  sortMessagesByTime,
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
  WsEvent, WsMsgRecv, WsMsgAck, WsSessionRekeyRequest,
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

function activeChatStorageKey(userId: string): string {
  return `harbiy-active-chat-${userId}`;
}

function saveActiveChatId(userId: string, chatId: string): void {
  try {
    sessionStorage.setItem(activeChatStorageKey(userId), chatId);
  } catch { /* sessionStorage bloklangan */ }
}

function loadSavedActiveChatId(userId: string): string | null {
  try {
    return sessionStorage.getItem(activeChatStorageKey(userId));
  } catch {
    return null;
  }
}

function clearSavedActiveChatId(userId: string): void {
  try {
    sessionStorage.removeItem(activeChatStorageKey(userId));
  } catch { /* ignore */ }
}

function forcePreKeyStorageKey(userId: string, peerId: string): string {
  return `e2ee-force-prekey-${userId}-${peerId}`;
}

function setForcePreKey(userId: string, peerId: string): void {
  try {
    sessionStorage.setItem(forcePreKeyStorageKey(userId, peerId), "1");
  } catch { /* ignore */ }
}

function consumeForcePreKey(userId: string, peerId: string): boolean {
  try {
    const k = forcePreKeyStorageKey(userId, peerId);
    if (sessionStorage.getItem(k) === "1") {
      sessionStorage.removeItem(k);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

const rekeyRequestSentAt = new Map<string, number>();
const REKEY_COOLDOWN_MS = 15_000;

function isPreKeyCiphertext(ciphertext: string): boolean {
  try {
    const val = JSON.parse(normalizePayload(ciphertext)) as { type?: number; prekey?: unknown; inner?: string };
    return val.type === 3 && !!val.prekey && !!val.inner;
  } catch {
    return false;
  }
}

/** Qabul qiluvchi sessiya yo'q — yuboruvchiga PreKey talab qiladi */
function requestSessionRekey(peerId: string, chatId: string): void {
  const now = Date.now();
  const last = rekeyRequestSentAt.get(peerId) ?? 0;
  if (now - last < REKEY_COOLDOWN_MS) return;
  rekeyRequestSentAt.set(peerId, now);
  console.log(`[E2EE] 🔑 session.rekey_request → ${peerId}`);
  wsClient.send("session.rekey_request", { peer_id: peerId, chat_id: chatId });
}

/** Xabar shifrlash: sessiya yo'q / tiklanganda PreKey, xato bo'lsa avtomatik qayta urinish */
async function prepareOutgoingCiphertext(
  chatId:      string,
  recipientId: string,
  plaintext:   string,
  token:       string,
): Promise<{ ciphertext: string; msgTypeNum: number }> {
  const authUserId = useAuthStore.getState().userId;
  const forcePreKey = authUserId ? consumeForcePreKey(authUserId, recipientId) : false;

  const sendPreKey = async () => {
    console.log(`[E2EE] 🔑 PreKeyMessage → ${recipientId}`);
    const bundle = await keysApi.getBundle(token, recipientId);
    return {
      ciphertext: await encryptFirstMessage(
        chatId,
        recipientId,
        JSON.stringify(bundle),
        plaintext,
      ),
      msgTypeNum: 3,
    };
  };

  if (forcePreKey) {
    await clearSession(recipientId).catch(() => {});
    return sendPreKey();
  }

  const sessionExists = await hasSession(recipientId).catch(() => false);
  if (!sessionExists) return sendPreKey();

  try {
    return {
      ciphertext: await encryptMessage(chatId, recipientId, plaintext),
      msgTypeNum: 1,
    };
  } catch (e) {
    console.warn("[E2EE] SignalMessage xato, PreKey ga o'tilmoqda:", e);
    await clearSession(recipientId).catch(() => {});
    return sendPreKey();
  }
}

function isOwnMessage(msg: Message, authUserId: string | null): boolean {
  if (!authUserId) return msg.sender_id === "me";
  return msg.sender_id === authUserId || msg.sender_id === "me";
}

function applyMediaType(msg: Message): Message {
  const mp = parseMediaPayload(msg.plaintext);
  if (!mp) return msg;
  const mt: Message["msg_type"] = mp.mime_type.startsWith("image/") ? "image" : "file";
  return { ...msg, msg_type: mt };
}

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

async function decryptHistoryMessage(
  chatId:     string,
  msg:        Message,
  local:      Message[],
  authUserId: string | null,
): Promise<Message> {
  if (msg.msg_type !== "text" || !msg.ciphertext) return msg;

  const hydrated = hydrateFromLocal(local, msg);
  if (isReadablePlaintext(hydrated.plaintext)) {
    return applyMediaType(hydrated);
  }

  // O'z yuborgan xabar — recv zanjir bilan ochilmaydi; faqat mahalliy plaintext
  if (isOwnMessage(msg, authUserId)) {
    return {
      ...msg,
      plaintext: hydrated.plaintext?.trim()
        ? hydrated.plaintext
        : MISSING_PLAINTEXT_LABEL,
    };
  }

  const pt = await decryptForHistory(chatId, msg.sender_id, msg.ciphertext);
  return applyMediaType({ ...msg, plaintext: pt });
}

/** PreKey dan oldingi ochilmaydigan xabarlarni belgilash */
function annotateObsoletePending(merged: Message[], authUserId: string | null): Message[] {
  let lastPeerPreKeyAt: string | null = null;
  for (const m of merged) {
    if (
      m.sender_id !== authUserId &&
      m.sender_id !== "me" &&
      isPreKeyCiphertext(m.ciphertext) &&
      isReadablePlaintext(m.plaintext) &&
      (!lastPeerPreKeyAt || m.created_at > lastPeerPreKeyAt)
    ) {
      lastPeerPreKeyAt = m.created_at;
    }
  }
  if (!lastPeerPreKeyAt) return merged;

  return merged.map((m) => {
    if (
      m.sender_id !== authUserId &&
      m.sender_id !== "me" &&
      m.created_at < lastPeerPreKeyAt! &&
      (isPendingDecrypt(m.plaintext) || isDecryptFailure(m.plaintext))
    ) {
      return { ...m, plaintext: "🔒 Eski sessiya xabari" };
    }
    return m;
  });
}

/** Suhbatdagi deshifrlanmagan xabarlarni qayta ochish (sessiya yangilanganida) */
async function redDecryptChatMessages(
  chatId: string,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
): Promise<void> {
  const msgs = get().messages[chatId];
  if (!msgs?.length) return;

  const authUserId = useAuthStore.getState().userId;
  const local      = await loadLocalMessages(chatId).catch(() => [] as Message[]);

  const updated = annotateObsoletePending(
    sortMessagesByTime(
      await (async () => {
        const out: Message[] = [];
        for (const msg of msgs) {
          if (isReadablePlaintext(msg.plaintext)) {
            out.push(msg);
            continue;
          }
          out.push(await decryptHistoryMessage(chatId, msg, local, authUserId));
        }
        return out;
      })()
    ),
    authUserId,
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

async function handlePeerRekeyRequest(
  fromUserId: string,
  chatId: string | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
): Promise<void> {
  const authUserId = useAuthStore.getState().userId;
  if (!authUserId) return;
  console.log(`[E2EE] 🔑 session.rekey_request qabul qilindi: from=${fromUserId}`);
  setForcePreKey(authUserId, fromUserId);
  await clearSession(fromUserId).catch(() => {});
  if (chatId) {
    await redDecryptChatMessages(chatId, set, get);
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
      const list = await chatApi.list(token);
      set({ chats: list ?? [], loading: false });

      const userId = useAuthStore.getState().userId;
      const saved  = userId ? loadSavedActiveChatId(userId) : null;
      if (saved && !get().activeChatId && (list ?? []).some((c) => c.id === saved)) {
        await get().selectChat(saved, token);
      }
    } catch (e) {
      console.error("[Chat] loadChats xatoligi:", e);
      set({ loading: false });
    }
  },

  // Suhbat tanlanganida tarixi yuklanadi (mahalliy + server, bir martalik)
  selectChat: async (chatId, token) => {
    set({ activeChatId: chatId });

    const userId = useAuthStore.getState().userId;
    if (userId) saveActiveChatId(userId, chatId);

    const chat = get().chats.find((c) => c.id === chatId);
    const peerId = chat?.peer_user_id ?? null;

    if (peerId) {
      const sessionExists = await hasSession(peerId).catch(() => false);
      console.log(
        `[E2EE] selectChat: peer=${peerId} session=${sessionExists ? "mavjud" : "yo'q — birinchi xabarda PreKeyMessage yaratiladi"}`
      );
    }

    try {
      const local   = await loadLocalMessages(chatId);
      const rawMsgs = await chatApi.history(token, chatId);

      const decrypted: Message[] = [];
      for (const msg of rawMsgs) {
        decrypted.push(await decryptHistoryMessage(chatId, msg, local, userId));
      }

      const merged = annotateObsoletePending(
        sortMessagesByTime(mergeMessages(local, decrypted)),
        userId,
      );
      const last   = merged[merged.length - 1];

      // O'qilgan deb belgilash — faqat ochilgan matn uchun
      for (const msg of merged) {
        if (
          msg.sender_id !== userId &&
          msg.sender_id !== "me" &&
          !msg.id.startsWith("local_") &&
          isReadablePlaintext(msg.plaintext)
        ) {
          wsClient.send("msg.read", { msg_id: msg.id });
        }
      }

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
                    unread_count: 0,
                  }
                : c
            )
          : s.chats.map((c) =>
              c.id === chatId ? { ...c, unread_count: 0 } : c
            ),
      }));

      for (const msg of merged) {
        if (isReadablePlaintext(msg.plaintext)) {
          await persistLocalMessage(msg).catch((e) =>
            console.warn("[Chat] persistLocalMessage:", e)
          );
        }
      }

      // Sherikdan ochilmagan xabarlar — avtomatik PreKey so'rovi
      if (peerId) {
        const needsRekey = merged.some(
          (m) =>
            m.sender_id === peerId &&
            (isPendingDecrypt(m.plaintext) || isDecryptFailure(m.plaintext))
        );
        if (needsRekey) {
          requestSessionRekey(peerId, chatId);
        }
      }
    } catch (e) {
      console.error("[Chat] server tarixi yuklanmadi:", e);
      // Server ishlamasa — faqat mahalliy tarix
      try {
        const local = await loadLocalMessages(chatId);
        if (local.length) {
          const sorted = sortMessagesByTime(local);
          set((s) => ({ messages: { ...s.messages, [chatId]: sorted } }));
        }
      } catch {
        /* ignore */
      }
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
      const { ciphertext, msgTypeNum } = await prepareOutgoingCiphertext(
        chatId, recipientId, plaintext, token
      );

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
      const { ciphertext, msgTypeNum } = await prepareOutgoingCiphertext(
        chatId, recipientId, plaintext, token
      );

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

            // Type-1 yuboruvchi eski sessiyada — PreKey talab qilamiz
            if (
              !isPreKeyCiphertext(m.ciphertext) &&
              (err.code === "SESSION_NOT_FOUND" || err.code === "AES_GCM_FAILED")
            ) {
              requestSessionRekey(m.sender_id, m.chat_id);
            }
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
            created_at: m.created_at ?? new Date().toISOString(),
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
          const token = useAuthStore.getState().token;
          const isActiveChat = get().activeChatId === m.chat_id;
          const chatKnownBefore = get().chats.some((c) => c.id === m.chat_id);

          set((s) => {
            const merged = sortMessagesByTime([...(s.messages[m.chat_id] ?? []), newMsg]);
            const chatKnown = s.chats.some((c) => c.id === m.chat_id);
            const chats = chatKnown
              ? s.chats.map((c) =>
                  c.id === m.chat_id
                    ? {
                        ...c,
                        last_message: {
                          sender_id:  m.sender_id,
                          preview:    previewFromMessage(newMsg),
                          created_at: newMsg.created_at,
                        },
                        unread_count: isActiveChat ? 0 : c.unread_count + 1,
                        updated_at:   newMsg.created_at,
                      }
                    : c
                )
              : [
                  {
                    id:           m.chat_id,
                    type:         "direct" as const,
                    title:        m.sender_id.slice(0, 8) + "…",
                    peer_user_id: m.sender_id,
                    last_message: {
                      sender_id:  m.sender_id,
                      preview:    previewFromMessage(newMsg),
                      created_at: newMsg.created_at,
                    },
                    unread_count: isActiveChat ? 0 : 1,
                    updated_at:   newMsg.created_at,
                  },
                  ...s.chats,
                ];
            return {
              messages: { ...s.messages, [m.chat_id]: merged },
              chats,
            };
          });

          if (!chatKnownBefore && token) {
            void get().loadChats(token);
          }

          if (isActiveChat && isReadablePlaintext(plaintext)) {
            wsClient.send("msg.read", { msg_id: m.msg_id });
          }

          // PreKey qabul qilinganda — kutilayotgan xabarlarni qayta ochish
          if (isReadablePlaintext(plaintext) && isPreKeyCiphertext(m.ciphertext)) {
            await redDecryptChatMessages(m.chat_id, set, get);
          }

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

      case "session.rekey_request": {
        const p = event.payload as WsSessionRekeyRequest;
        void handlePeerRekeyRequest(p.from_user_id, p.chat_id, set, get);
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
    const prev = activeAccountId;
    activeAccountId = userId;

    // Faqat boshqa akkauntga o'tganda holat tozalanadi (refresh emas)
    if (prev !== null && prev !== userId) {
      clearSavedActiveChatId(prev);
      set({
        chats:        [],
        messages:     {},
        activeChatId: null,
        presenceMap:  {},
        userResults:  [],
      });
      console.log(`[Chat] onAccountSwitch: ${prev} → ${userId}, holat tozalandi`);
    } else {
      console.log(`[Chat] onAccountSwitch: ${userId} (refresh yoki birinchi faollashtirish)`);
    }
    void initNotifications();
  },

  // ── Sessiyani qayta tiklash ───────────────────────────────────────────────
  //
  // Sessiya tozalanadi. Keyingi xabarda sendMessage avtomatik PreKeyMessage
  // yaratadi — alohida 'session.rekey_request' WS event kerak emas.
  resetSessionWithPeer: async (chatId, peerId, _token) => {
    console.log(`[E2EE] Sessiyani qayta tiklash: peer=${peerId}`);
    const authUserId = useAuthStore.getState().userId;
    if (authUserId) setForcePreKey(authUserId, peerId);
    await clearSession(peerId);
    requestSessionRekey(peerId, chatId);

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
