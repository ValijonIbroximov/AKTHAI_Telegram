// Mahalliy ochiq matn tarixi — E2EE qoidasiga ko'ra serverda faqat shifrlangan.
// Brauzer: IndexedDB (harbiy-signal-{userId})  |  Tauri: SQLite (signal_{userId}.db)
//
// QOIDA: Xabar FAQAT bir marta deshifrlanadi (msg.recv paytida).
//        Bu fayldan qaytgan xabarlar TO'G'RIDAN-TO'G'RI UI ga uzatiladi — qayta deshifrlash YO'Q.

import type { Message } from "@/types";
import { isTauri } from "@/crypto/adapter";
import { scopedIdbName, getActiveCryptoUserId } from "@/crypto/userScope";
import { isReadablePlaintext } from "@/utils/messageText";
import { useAuthStore } from "@/store/authStore";

export interface StoredMessage {
  id:         string;
  chat_id:    string;
  sender_id:  string;
  plaintext:  string;   // faqat ochiq matn saqlanadi
  ciphertext: string;   // ID matching fallback uchun
  msg_type:   Message["msg_type"];
  status:     Message["status"];
  created_at: string;
}

const IDB_VERSION = 4;
const STORE       = "message_history";

// ── Hisob konteksti nazorati ─────────────────────────────────────────────────

/**
 * Faqat joriy akkaunt DB sida operatsiya amalga oshirilishini kafolatlaydi.
 * - cryptoId null bo'lsa: faqat OGOHLANTIRISH (bootstrap/gecikmə — bloklamaymiz).
 * - auth ≠ crypto (mismatch): JIDDIY XATOLIK — cross-account sizib chiqish oldini olish.
 * Returns: active crypto userId, yoki null agar hali o'rnatilmagan bo'lsa.
 */
function assertAccountScope(): string | null {
  const cryptoId = getActiveCryptoUserId();

  if (!cryptoId) {
    console.warn("[LocalHistory] ⚠ crypto user ID hali o'rnatilmagan — operatsiya davom etadi");
    return null;
  }

  const authId = useAuthStore.getState().userId;
  if (authId && authId !== cryptoId) {
    const msg = `[LocalHistory] ✖ ACCOUNT MISMATCH: auth=${authId} crypto=${cryptoId}`;
    console.error(msg);
    throw new Error(`ACCOUNT_MISMATCH:${authId}!=${cryptoId}`);
  }

  return cryptoId;
}

// ── Converterlar ─────────────────────────────────────────────────────────────

function toStored(m: Message): StoredMessage | null {
  if (!isReadablePlaintext(m.plaintext)) return null;
  return {
    id:         m.id,
    chat_id:    m.chat_id,
    sender_id:  m.sender_id,
    plaintext:  m.plaintext!,
    ciphertext: m.ciphertext ?? "",
    msg_type:   m.msg_type,
    status:     m.status,
    created_at: m.created_at,
  };
}

function fromStored(s: StoredMessage): Message {
  return {
    id:         s.id,
    chat_id:    s.chat_id,
    sender_id:  s.sender_id,
    ciphertext: s.ciphertext,
    plaintext:  s.plaintext,   // allaqachon ochiq matn — qayta deshifrlash kerak emas
    msg_type:   s.msg_type,
    status:     s.status,
    created_at: s.created_at,
  };
}

// ── IndexedDB (brauzer) ─────────────────────────────────────────────────────

function openHistoryDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(scopedIdbName(), IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "peerId" });
      if (!db.objectStoreNames.contains("identity"))
        db.createObjectStore("identity", { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("chat_id", "chat_id", { unique: false });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbSaveMessage(msg: StoredMessage): Promise<void> {
  const db = await openHistoryDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(msg);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function idbDeleteMessage(id: string): Promise<void> {
  const db = await openHistoryDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function idbLoadByChat(chatId: string): Promise<StoredMessage[]> {
  const db = await openHistoryDb();
  return new Promise((res) => {
    const tx  = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("chat_id");
    const req = idx.getAll(chatId);
    req.onsuccess = () => {
      const rows = (req.result as StoredMessage[]) ?? [];
      rows.sort((a, b) => messageTimestamp(a.created_at) - messageTimestamp(b.created_at));
      res(rows);
    };
    req.onerror = () => res([]);
  });
}

// ── Vaqt bo'yicha tartiblash ─────────────────────────────────────────────────

/** Server/mahalliy created_at qiymatini millisekundga aylantiradi */
export function messageTimestamp(createdAt: string | undefined | null): number {
  if (!createdAt) return 0;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : 0;
}

/** Xabarlarni yozilgan vaqt bo'yicha o'sish tartibida saralaydi (barqaror) */
export function sortMessagesByTime(msgs: Message[]): Message[] {
  return [...msgs].sort((a, b) => {
    const diff = messageTimestamp(a.created_at) - messageTimestamp(b.created_at);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

/** Server xabari uchun mahalliy nusxa (ID yoki ciphertext bo'yicha) */
export function findLocalMatch(local: Message[], remote: Message): Message | null {
  // 1) ID bo'yicha to'g'ri moslash
  const byId = local.find((l) => l.id === remote.id);
  if (byId && isReadablePlaintext(byId.plaintext)) return byId;

  // 2) Ciphertext bo'yicha fallback (ACK kelishidan oldin local_* ID lari uchun)
  if (remote.ciphertext?.trim()) {
    const byCt = local.find(
      (l) =>
        l.ciphertext === remote.ciphertext &&
        l.chat_id    === remote.chat_id    &&
        isReadablePlaintext(l.plaintext)
    );
    if (byCt) return byCt;
  }
  return null;
}

/**
 * Server xabarini mahalliy ochiq matn bilan to'ldiradi.
 * Mahalliy nusxa topilsa — decryptMessage CHAQIRILMAYDI.
 */
export function hydrateFromLocal(local: Message[], remote: Message): Message {
  const hit = findLocalMatch(local, remote);
  if (!hit) return remote;
  return {
    ...remote,
    plaintext: hit.plaintext,
    status:    hit.status ?? remote.status,
  };
}

/**
 * Server va mahalliy ro'yxatlarni birlashtiradi.
 * Mahalliy ochiq matn har doim server (null) dan ustun.
 */
export function mergeMessages(local: Message[], remote: Message[]): Message[] {
  const map = new Map<string, Message>();

  // Server xabarlari asosiy kalit bo'lib kiritiladi
  for (const m of remote) map.set(m.id, m);

  // Mahalliy ochiq matn server ustidan yoziladi
  for (const m of local) {
    if (!isReadablePlaintext(m.plaintext)) continue;
    const existing = map.get(m.id);
    if (existing) {
      map.set(m.id, { ...existing, plaintext: m.plaintext, status: m.status ?? existing.status });
      continue;
    }
    // local_* ID (ACK oldin) ↔ server uuid dublikatini ciphertext bo'yicha filtrlash
    if (m.ciphertext?.trim()) {
      const dup = [...map.values()].some(
        (r) => r.ciphertext === m.ciphertext && r.chat_id === m.chat_id
      );
      if (dup) continue;
    }
    map.set(m.id, m);
  }

  // Ciphertext bo'yicha fallback: server xabarlari uchun mahalliy ochiq matn topish
  for (const r of remote) {
    const cur = map.get(r.id);
    if (isReadablePlaintext(cur?.plaintext)) continue;
    const hit = findLocalMatch(local, r);
    if (hit) map.set(r.id, { ...r, plaintext: hit.plaintext, status: hit.status ?? r.status });
  }

  return sortMessagesByTime([...map.values()]);
}

// ── Umumiy API ──────────────────────────────────────────────────────────────

/**
 * Muvaffaqiyatli deshifrlangan yoki yuborilgan xabarni mahalliy bazaga yozadi.
 * Faqat isReadablePlaintext() o'tgan xabarlar saqlanadi.
 */
export async function persistLocalMessage(msg: Message): Promise<void> {
  const userId = assertAccountScope();   // null → ogohlantirish, davom etadi; mismatch → throw

  const row = toStored(msg);
  if (!row) return;   // plaintext yo'q yoki label — saqlanmaydi

  try {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      // Rust StoredMessage turini kutadi — row (toStored) dan olamiz
      await invoke<void>("save_local_message", {
        msg: row,
        userId: userId ?? "",
      });
      return;
    }
    await idbSaveMessage(row);
  } catch (e) {
    console.error("[LocalHistory] persistLocalMessage FAILED:", e);
    throw e;
  }
}

/**
 * client_msg_id → server_msg_id: mahalliy bazada ID yangilanadi (ACK dan keyin).
 */
export async function migrateLocalMessageId(
  oldId: string,
  msg:   Message
): Promise<void> {
  if (oldId === msg.id) return;
  const userId = assertAccountScope();

  const row = toStored(msg);
  if (!row) return;

  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("migrate_local_message_id", {
      oldId,
      msg: row,         // Rust StoredMessage turini kutadi
      userId: userId ?? "",
    });
    return;
  }
  await idbDeleteMessage(oldId).catch(() => {});
  await idbSaveMessage(row);
}

/**
 * Suhbat tarixini mahalliy bazadan o'qish.
 * Qaytarilgan xabarlar allaqachon OCHIQ MATN — decryptMessage CHAQIRMA.
 */
export async function loadLocalMessages(chatId: string): Promise<Message[]> {
  const userId = assertAccountScope();

  try {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      const rows = await invoke<StoredMessage[]>("load_local_messages", {
        chatId,
        userId: userId ?? "",
      });
      return sortMessagesByTime((rows ?? []).map(fromStored));
    }
    const rows = await idbLoadByChat(chatId);
    return sortMessagesByTime(rows.map(fromStored));
  } catch (e) {
    console.error("[LocalHistory] loadLocalMessages FAILED:", e);
    return [];   // xato bo'lsa bo'sh qaytaramiz — UI ishini to'xtatmaymiz
  }
}
