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
  getSessionRole,
  clearSession,
  DECRYPT_ERROR_LABEL,
  classifyDecryptError,
  logDecryptError,
} from "@/crypto/adapter";
import { normalizePayload } from "@/crypto/webCrypto";
import { chatApi, keysApi, userApi, mediaApi } from "@/api/http";
import { encryptFile, parseMediaPayload, fcToB64, mediaKindFromMime, type MediaPayload } from "@/crypto/fileCrypto";
import {
  CHANNEL_MSG_TYPE,
  encryptChannelPayload,
  decryptChannelPayload,
  initChannelKey,
  isChannelMsgType,
} from "@/crypto/channelCrypto";
import { albumPreviewText } from "@/utils/messageAlbum";
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
  SESSION_SYNC_PLAINTEXT,
  isSessionSyncPlaintext,
} from "@/utils/messageText";
import {
  initNotifications,
  shouldNotifyIncoming,
  notifyIncomingMessage,
} from "@/utils/notifications";
import type {
  Chat, Message, User,
  WsEvent, WsMsgRecv, WsMsgAck, WsMsgRead, WsSessionRekeyRequest,
} from "@/types";

interface ChatState {
  chats:        Chat[];
  activeChatId: string | null;
  messages:     Record<string, Message[]>;
  presenceMap:         Record<string, boolean>;
  lastSeenMap:         Record<string, string | null>;
  lastSeenHiddenMap:   Record<string, boolean>;
  loading:      boolean;

  userResults:    User[];
  userLoading:    boolean;

  loadChats:        (token: string) => Promise<void>;
  selectChat:       (chatId: string, token: string) => Promise<void>;
  closeChat:        () => void;
  createChat:       (peer: User, token: string) => Promise<void>;
  createChannel:    (title: string, description: string, token: string) => Promise<void>;
  sendMessage:      (chatId: string, recipientId: string, plaintext: string, token: string) => Promise<void>;
  sendFileMessage:  (
    chatId: string,
    recipientId: string,
    file: File,
    token: string,
    options?: {
      caption?: string;
      asDocument?: boolean;
      spoiler?: boolean;
      albumId?: string;
      albumIndex?: number;
      albumCount?: number;
    },
  ) => Promise<void>;
  sendFileMessages: (
    chatId: string,
    recipientId: string,
    files: { file: File; spoiler?: boolean }[],
    token: string,
    options?: { caption?: string; asDocument?: boolean },
  ) => Promise<void>;
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
const rekeyReceivedFromAt = new Map<string, number>();
const REKEY_COOLDOWN_MS = 15_000;
const REKEY_RECEIVE_SUPPRESS_MS = 45_000;

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
  const lastSent = rekeyRequestSentAt.get(peerId) ?? 0;
  if (now - lastSent < REKEY_COOLDOWN_MS) return;
  const lastRecv = rekeyReceivedFromAt.get(peerId) ?? 0;
  if (now - lastRecv < REKEY_RECEIVE_SUPPRESS_MS) {
    console.log(`[E2EE] session.rekey_request o'tkazildi (peer allaqachon sinxronlashmoqda): ${peerId}`);
    return;
  }
  rekeyRequestSentAt.set(peerId, now);
  console.log(`[E2EE] 🔑 session.rekey_request → ${peerId}`);
  wsClient.send("session.rekey_request", { peer_id: peerId, chat_id: chatId });
}

/** Ko'rinmas PreKey xabar — qarama-qarshi tomonga sessiyani tiklaydi */
async function sendSessionSyncPreKey(
  chatId:      string,
  peerId:      string,
  token:       string,
): Promise<void> {
  const { ciphertext, msgTypeNum, recipientId: rid } = await prepareOutgoingPayload(
    chatId, peerId, SESSION_SYNC_PLAINTEXT, token,
  );
  wsClient.send("msg.send", {
    chat_id:       chatId,
    recipient_id:  rid,
    ciphertext,
    msg_type:      msgTypeNum,
    client_msg_id: `sync_${Date.now()}`,
  });
  console.log(`[E2EE] 🔑 PreKey sinxron xabari yuborildi → ${peerId}`);
}

function isChannelChat(chatId: string): boolean {
  return useChatStore.getState().chats.find((c) => c.id === chatId)?.type === "channel";
}

/** Kanal yoki Signal — xabar shifrlash */
async function prepareOutgoingPayload(
  chatId:      string,
  recipientId: string,
  plaintext:   string,
  token:       string,
): Promise<{ ciphertext: string; msgTypeNum: number; recipientId: string }> {
  const authUserId = useAuthStore.getState().userId;
  if (isChannelChat(chatId) && authUserId) {
    return {
      ciphertext:  await encryptChannelPayload(authUserId, chatId, plaintext),
      msgTypeNum:  CHANNEL_MSG_TYPE,
      recipientId: authUserId,
    };
  }
  const { ciphertext, msgTypeNum } = await prepareOutgoingCiphertext(
    chatId, recipientId, plaintext, token,
  );
  return { ciphertext, msgTypeNum, recipientId };
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

  const sessionRole = await getSessionRole(recipientId).catch(() => null);
  if (sessionRole === "receiver") {
    try {
      return {
        ciphertext: await encryptMessage(chatId, recipientId, plaintext),
        msgTypeNum: 1,
      };
    } catch (e) {
      console.warn("[E2EE] Qabul sessiyasidan yuborib bo'lmadi, PreKey ga o'tilmoqda:", e);
      await clearSession(recipientId).catch(() => {});
      return sendPreKey();
    }
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
  const mt: Message["msg_type"] = mediaKindFromMime(mp.mime_type);
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
    const cap = media.caption?.trim();
    if (media.album_count && media.album_count > 1) {
      return albumPreviewText(media.album_count, cap);
    }
    if (cap) return cap.length > 80 ? cap.slice(0, 77) + "…" : cap;
    if (media.mime_type.startsWith("image/")) return `🖼 ${media.file_name}`;
    if (media.mime_type.startsWith("video/")) return `🎬 ${media.file_name}`;
    return `📎 ${media.file_name}`;
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
  msgTypeNum?: number,
): Promise<string> {
  if (!ciphertext?.trim()) return "";

  const authUserId = useAuthStore.getState().userId;
  if (isChannelChat(chatId) || (msgTypeNum !== undefined && isChannelMsgType(msgTypeNum))) {
    if (!authUserId) throw new Error("Kanal xabarini ochish uchun kirish kerak");
    return decryptChannelPayload(authUserId, chatId, ciphertext);
  }

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
  msgTypeNum?: number,
): Promise<string> {
  try {
    return await decryptPlaintext(chatId, senderId, ciphertext, msgTypeNum);
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
  rawMsgType?: number,
): Promise<Message> {
  const channel = isChannelChat(chatId);
  if (!msg.ciphertext?.trim()) return msg;

  const hydrated = hydrateFromLocal(local, msg);
  if (isReadablePlaintext(hydrated.plaintext)) {
    return applyMediaType(hydrated);
  }

  // O'z yuborgan xabar — mahalliy plaintext yoki kanal kaliti bilan
  if (isOwnMessage(msg, authUserId)) {
    if (channel && msg.ciphertext) {
      try {
        const pt = await decryptChannelPayload(authUserId!, chatId, msg.ciphertext);
        return applyMediaType({ ...msg, plaintext: pt });
      } catch {
        /* fallback */
      }
    }
    return {
      ...msg,
      plaintext: hydrated.plaintext?.trim()
        ? hydrated.plaintext
        : MISSING_PLAINTEXT_LABEL,
    };
  }

  const pt = await decryptForHistory(chatId, msg.sender_id, msg.ciphertext, rawMsgType);
  return applyMediaType({ ...msg, plaintext: pt });
}

/** Tarix xabarlarini vaqt tartibida deshifrlash (Signal ratchet ketma-ketligi) */
async function decryptHistoryBatch(
  chatId:     string,
  rawMsgs:    Message[],
  serverTypes: Map<string, number>,
  local:      Message[],
  authUserId: string | null,
): Promise<Message[]> {
  const sorted = sortMessagesByTime([...rawMsgs]);
  const out: Message[] = [];
  for (const msg of sorted) {
    out.push(
      await decryptHistoryMessage(
        chatId,
        msg,
        local,
        authUserId,
        serverTypes.get(msg.id),
      ),
    );
  }
  return out;
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
  const token = useAuthStore.getState().token;
  if (!authUserId) return;
  rekeyReceivedFromAt.set(fromUserId, Date.now());
  console.log(`[E2EE] 🔑 session.rekey_request qabul qilindi: from=${fromUserId}`);
  setForcePreKey(authUserId, fromUserId);
  await clearSession(fromUserId).catch(() => {});
  if (chatId) {
    await redDecryptChatMessages(chatId, set, get);
  }
  if (token && chatId) {
    try {
      await sendSessionSyncPreKey(chatId, fromUserId, token);
    } catch (e) {
      console.warn("[E2EE] PreKey sinxron xabari yuborib bo'lmadi:", e);
    }
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  chats:        [],
  activeChatId: null,
  messages:     {},
  presenceMap:  {},
  lastSeenMap:  {},
  lastSeenHiddenMap: {},
  loading:      false,
  userResults:  [],
  userLoading:  false,

  // Suhbatlar ro'yxati serverdan yuklanadi
  loadChats: async (token) => {
    set({ loading: true });
    try {
      const list = await chatApi.list(token);
      const presenceMap = { ...get().presenceMap };
      const lastSeenMap = { ...get().lastSeenMap };
      const lastSeenHiddenMap = { ...get().lastSeenHiddenMap };
      for (const c of list ?? []) {
        if (!c.peer_user_id) continue;
        if (c.peer_online !== undefined) {
          presenceMap[c.peer_user_id] = c.peer_online;
        }
        lastSeenHiddenMap[c.peer_user_id] = c.peer_last_seen_hidden ?? false;
        if (c.peer_last_seen_at != null) {
          lastSeenMap[c.peer_user_id] = c.peer_last_seen_at;
        }
      }
      set({ chats: list ?? [], presenceMap, lastSeenMap, lastSeenHiddenMap, loading: false });

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
      const rawRows = await chatApi.historyRaw(token, chatId);
      const rawMsgs = rawRows.map((r) => r.message);
      const serverTypes = new Map(rawRows.map((r) => [r.message.id, r.serverMsgType]));

      const decrypted = await decryptHistoryBatch(
        chatId, rawMsgs, serverTypes, local, userId,
      );

      const merged = annotateObsoletePending(
        sortMessagesByTime(mergeMessages(local, decrypted)).filter(
          (m) => !isSessionSyncPlaintext(m.plaintext),
        ),
        userId,
      );
      const last   = merged[merged.length - 1];

      // O'qilgan deb belgilash — faqat ochilgan va hali read bo'lmagan xabarlar
      for (const msg of merged) {
        if (
          msg.sender_id !== userId &&
          msg.sender_id !== "me" &&
          !msg.id.startsWith("local_") &&
          !msg.id.startsWith("sync_") &&
          msg.status !== "read" &&
          isReadablePlaintext(msg.plaintext) &&
          !isSessionSyncPlaintext(msg.plaintext)
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
        if (isReadablePlaintext(msg.plaintext) && !isSessionSyncPlaintext(msg.plaintext)) {
          await persistLocalMessage(msg).catch((e) =>
            console.warn("[Chat] persistLocalMessage:", e)
          );
        }
      }

      // Sherikdan ochilmagan xabarlar — avtomatik PreKey so'rovi (qarama-qarshi rekey tsiklini oldini olish bilan)
      if (peerId && !isChannelChat(chatId)) {
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

  closeChat: () => {
    set({ activeChatId: null });
    const userId = useAuthStore.getState().userId;
    if (userId) clearSavedActiveChatId(userId);
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
        userResults:  [],
      }));
      await get().selectChat(chatId, token);
    } catch (e) {
      console.error("[Chat] createChat xatoligi:", e);
    }
  },

  createChannel: async (title, description, token) => {
    const authUserId = useAuthStore.getState().userId;
    if (!authUserId) return;

    try {
      const { id: chatId } = await chatApi.createChannel(token, title, description);
      initChannelKey(authUserId, chatId);

      const now = new Date().toISOString();
      const newChat: Chat = {
        id:           chatId,
        type:         "channel",
        title,
        description:  description || null,
        peer_user_id: null,
        last_message: null,
        unread_count: 0,
        updated_at:   now,
      };

      set((s) => ({
        chats: [newChat, ...s.chats.filter((c) => c.id !== chatId)],
      }));
      await get().selectChat(chatId, token);
    } catch (e) {
      console.error("[Chat] createChannel xatoligi:", e);
      throw e;
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
      const { ciphertext, msgTypeNum, recipientId: rid } = await prepareOutgoingPayload(
        chatId, recipientId, plaintext, token
      );

      wsClient.send("msg.send", {
        chat_id:       chatId,
        recipient_id:  rid,
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
  sendFileMessage: async (chatId, recipientId, file, token, options) => {
    const localId = `local_${Date.now()}`;
    const now     = new Date().toISOString();
    const asDocument = options?.asDocument ?? false;
    const kind = mediaKindFromMime(file.type, asDocument);
    const mediaType: Message["msg_type"] = kind;
    const caption = options?.caption?.trim() ?? "";
    const albumCount = options?.albumCount ?? 0;
    const isAlbum = albumCount > 1;
    const displayPreview = isAlbum && options?.albumIndex === albumCount - 1
      ? albumPreviewText(albumCount, caption)
      : caption
        ? caption
        : kind === "image" ? `🖼 ${file.name}`
          : kind === "video" ? `🎬 ${file.name}`
            : `📎 ${file.name}`;

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
        ...(caption ? { caption } : {}),
        ...(options?.spoiler ? { spoiler: true } : {}),
        ...(options?.albumId ? {
          album_id:    options.albumId,
          album_index: options.albumIndex ?? 0,
          album_count: options.albumCount ?? 1,
        } : {}),
      };
      const plaintext = JSON.stringify(payload);

      const { ciphertext, msgTypeNum, recipientId: rid } = await prepareOutgoingPayload(
        chatId, recipientId, plaintext, token
      );

      wsClient.send("msg.send", {
        chat_id:       chatId,
        recipient_id:  rid,
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

      const isLastAlbumItem =
        !options?.albumId ||
        options.albumIndex === undefined ||
        options.albumIndex >= (options.albumCount ?? 1) - 1;

      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((m) => m.id === localId ? sentMsg : m),
        },
        chats: isLastAlbumItem
          ? s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    last_message: { sender_id: "me", preview: displayPreview, created_at: now },
                    updated_at:   now,
                  }
                : c
            )
          : s.chats,
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

  sendFileMessages: async (chatId, recipientId, files, token, options) => {
    if (files.length === 0) return;
    const albumId = files.length > 1 ? crypto.randomUUID() : undefined;
    const caption = options?.caption?.trim() ?? "";
    for (let i = 0; i < files.length; i++) {
      const item = files[i]!;
      await get().sendFileMessage(chatId, recipientId, item.file, token, {
        asDocument: options?.asDocument,
        spoiler:    item.spoiler ?? false,
        caption:    i === files.length - 1 ? caption : undefined,
        albumId,
        albumIndex: i,
        albumCount: files.length,
      });
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
          const channelMsg = isChannelChat(m.chat_id) || (m.msg_type != null && isChannelMsgType(m.msg_type));
          try {
            if (channelMsg) {
              const authUserId = useAuthStore.getState().userId;
              if (!authUserId) throw new Error("auth");
              plaintext = await decryptChannelPayload(authUserId, m.chat_id, m.ciphertext);
              console.log(`[WS] ✅ Kanal deshifrlandi: id=${m.msg_id} len=${plaintext.length}`);
            } else {
              plaintext = await decryptMessage(m.chat_id, m.sender_id, m.ciphertext);
              console.log(`[WS] ✅ Deshifrlandi: id=${m.msg_id} len=${plaintext.length}`);
            }
          } catch (e) {
            const err = channelMsg
              ? { code: "AES_GCM_FAILED" as const }
              : classifyDecryptError(e);
            console.warn(`[WS] ❌ Deshifrlash xatosi: id=${m.msg_id} code=${err.code}`);
            // SESSION_NOT_FOUND: sessiya yo'q (Type 1 message, eski sessiya)
            // Boshqa xato: noto'g'ri kalit yoki buzilgan xabar
            plaintext =
              err.code === "SESSION_NOT_FOUND"
                ? PENDING_DECRYPT_LABEL
                : DECRYPT_ERROR_LABEL;

            // Type-1 yuboruvchi eski sessiyada — PreKey talab qilamiz
            if (
              !channelMsg &&
              !isPreKeyCiphertext(m.ciphertext) &&
              (err.code === "SESSION_NOT_FOUND" || err.code === "AES_GCM_FAILED")
            ) {
              requestSessionRekey(m.sender_id, m.chat_id);
            }
          }

          const isActiveChat = get().activeChatId === m.chat_id;

          // Ko'rinmas sessiya sinxronizatsiyasi — UI ga qo'shilmaydi
          if (isSessionSyncPlaintext(plaintext)) {
            wsClient.send("msg.delivered", { msg_id: m.msg_id });
            if (isActiveChat) {
              wsClient.send("msg.read", { msg_id: m.msg_id });
            }
            if (isPreKeyCiphertext(m.ciphertext)) {
              await redDecryptChatMessages(m.chat_id, set, get);
            }
            return;
          }

          // Media xabar ekanligini deshifrlangan plaintext JSON'dan aniqlaymiz
          // msg_type: "image" | "file" | "text" — MessageBubble shu qiymatga tayanadi
          const mediaP = parseMediaPayload(plaintext);
          const detectedType: Message["msg_type"] = mediaP
            ? mediaKindFromMime(mediaP.mime_type)
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
              await notifyIncomingMessage({
                chatId:    m.chat_id,
                chatTitle: chat?.title?.trim() || "Yangi xabar",
                preview:   notifyText,
                isGroup:   chat?.type === "group",
              });
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

      case "msg.read": {
        const p = event.payload as WsMsgRead;
        let readMsg: Message | undefined;
        set((s) => {
          const msgs = s.messages[p.chat_id];
          if (!msgs) return s;
          const next = msgs.map((m) => {
            if (m.id !== p.msg_id) return m;
            readMsg = { ...m, status: "read" as const };
            return readMsg;
          });
          return { messages: { ...s.messages, [p.chat_id]: next } };
        });
        if (readMsg && isReadablePlaintext(readMsg.plaintext)) {
          void persistLocalMessage(readMsg).catch((e) =>
            console.warn("[WS] persistLocalMessage (read):", e)
          );
        }
        break;
      }

      case "presence": {
        const p = event.payload;
        set((s) => {
          const lastSeenHiddenMap = { ...s.lastSeenHiddenMap };
          if (p.last_seen_hidden) {
            lastSeenHiddenMap[p.user_id] = true;
          } else if (!p.online) {
            lastSeenHiddenMap[p.user_id] = false;
          }

          return {
            presenceMap: { ...s.presenceMap, [p.user_id]: p.online },
            lastSeenHiddenMap,
            lastSeenMap:
              p.online || p.last_seen_hidden
                ? s.lastSeenMap
                : {
                    ...s.lastSeenMap,
                    [p.user_id]: p.last_seen_at ?? new Date().toISOString(),
                  },
            chats: s.chats.map((c) =>
              c.peer_user_id === p.user_id
                ? {
                    ...c,
                    peer_online: p.online,
                    peer_last_seen_hidden: p.last_seen_hidden ?? false,
                    peer_last_seen_at: p.last_seen_hidden
                      ? null
                      : (p.last_seen_at ?? c.peer_last_seen_at ?? null),
                  }
                : c
            ),
          };
        });
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
        lastSeenMap:  {},
        lastSeenHiddenMap: {},
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
