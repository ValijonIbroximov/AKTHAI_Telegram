// Mahalliy ochiq matn tarixi — E2EE qoidasiga ko'ra serverda faqat shifrlangan.
// Brauzer: IndexedDB (harbiy-signal-{userId}) | Tauri: SQLite (signal_{userId}.db)

import type { Message } from "@/types";
import { isTauri } from "@/crypto/adapter";
import { scopedIdbName, getActiveCryptoUserId } from "@/crypto/userScope";
import { isReadablePlaintext } from "@/utils/messageText";
import { useAuthStore } from "@/store/authStore";

export interface StoredMessage {
  id:         string;
  chat_id:    string;
  sender_id:  string;
  plaintext:  string;
  ciphertext: string;
  msg_type:   Message["msg_type"];
  status:     Message["status"];
  created_at: string;
}

const IDB_VERSION = 4;
const STORE       = "message_history";

/** Faqat joriy akkaunt kontekstida ishlaydi.
 *  Agar kripto kontekst o'rnatilmagan yoki auth bilan mos kelmasa — operatsiyani bloklaymiz. */
function assertAccountScope(): void {
  const authId   = useAuthStore.getState().userId;
  const cryptoId = getActiveCryptoUserId();

  if (!cryptoId) {
    // Kripto kontekst hali o'rnatilmagan — bootstrap davomida bo'lishi mumkin
    console.warn("[LocalHistory] ⚠ crypto user not set — skipping local op");
    throw new Error("CRYPTO_USER_NOT_SET");
  }

  if (authId && authId !== cryptoId) {
    // Auth va kripto kontekst mos kelmaydi — cross-account data sızıqlığını oldini olish
    console.error(
      `[LocalHistory] ✖ account mismatch: auth=${authId} crypto=${cryptoId} — blocking`
    );
    throw new Error(`ACCOUNT_MISMATCH:${authId}!=${cryptoId}`);
  }
}

function toStored(m: Message): StoredMessage | null {
  if (!isReadablePlaintext(m.plaintext)) return null;
  return {
    id:         m.id,
    chat_id:    m.chat_id,
    sender_id:  m.sender_id,
    plaintext:  m.plaintext!,
    ciphertext: m.ciphertext,
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
    plaintext:  s.plaintext,
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
      rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      res(rows);
    };
    req.onerror = () => res([]);
  });
}

// ── Mahalliy ↔ server moslash ───────────────────────────────────────────────

/** Server xabari uchun mahalliy nusxa (id yoki ciphertext bo'yicha) */
export function findLocalMatch(local: Message[], remote: Message): Message | null {
  const byId = local.find((l) => l.id === remote.id);
  if (byId && isReadablePlaintext(byId.plaintext)) return byId;

  if (remote.ciphertext?.trim()) {
    const byCt = local.find(
      (l) =>
        l.ciphertext === remote.ciphertext &&
        l.chat_id === remote.chat_id &&
        isReadablePlaintext(l.plaintext)
    );
    if (byCt) return byCt;
  }
  return null;
}

/** Mahalliy ochiq matn bor bo'lsa server xabarini shu bilan to'ldiradi (qayta deshifrlash yo'q) */
export function hydrateFromLocal(local: Message[], remote: Message): Message {
  const hit = findLocalMatch(local, remote);
  if (!hit) return remote;
  return {
    ...remote,
    id:        remote.id,
    plaintext: hit.plaintext,
    status:    hit.status ?? remote.status,
  };
}

/** Server va mahalliy ro'yxatlarni id bo'yicha birlashtirish; ochiq matnda mahalliy ustun */
export function mergeMessages(local: Message[], remote: Message[]): Message[] {
  const map = new Map<string, Message>();

  for (const m of remote) {
    map.set(m.id, m);
  }

  for (const m of local) {
    const existing = map.get(m.id);
    if (isReadablePlaintext(m.plaintext)) {
      map.set(
        m.id,
        existing
          ? { ...existing, plaintext: m.plaintext, status: m.status ?? existing.status }
          : m
      );
      continue;
    }
    if (!existing) {
      map.set(m.id, m);
    }
  }

  // local_* → server id (ciphertext mosligi): server id bilan bog'lash
  for (const r of remote) {
    if (map.has(r.id) && isReadablePlaintext(map.get(r.id)!.plaintext)) continue;
    const hit = findLocalMatch(local, r);
    if (hit && isReadablePlaintext(hit.plaintext)) {
      map.set(r.id, { ...r, plaintext: hit.plaintext, status: hit.status ?? r.status });
    }
  }

  // Faqat mahalliyda mavjud (hali serverda yo'q) xabarlar
  for (const m of local) {
    if (![...map.values()].some((x) => x.id === m.id || (m.ciphertext && x.ciphertext === m.ciphertext))) {
      if (isReadablePlaintext(m.plaintext)) {
        map.set(m.id, m);
      }
    }
  }

  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// ── Umumiy API ──────────────────────────────────────────────────────────────

/** Muvaffaqiyatli deshifrlangan yoki yuborilgan xabarni mahalliy bazaga yozadi */
export async function persistLocalMessage(msg: Message): Promise<void> {
  assertAccountScope();
  const row = toStored(msg);
  if (!row) return;

  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("save_local_message", { msg: row });
    return;
  }
  await idbSaveMessage(row);
}

/** client_msg_id → server_msg_id: mahalliy bazada id yangilanadi */
export async function migrateLocalMessageId(
  oldId: string,
  msg:   Message
): Promise<void> {
  if (oldId === msg.id) return;
  assertAccountScope();
  const row = toStored(msg);
  if (!row) return;

  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("migrate_local_message_id", { oldId, msg: row });
    return;
  }
  await idbDeleteMessage(oldId).catch(() => {});
  await idbSaveMessage(row);
}

/** Suhbat tarixini mahalliy bazadan o'qish (refresh / account switch dan keyin) */
export async function loadLocalMessages(chatId: string): Promise<Message[]> {
  assertAccountScope();

  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const rows = await invoke<StoredMessage[]>("load_local_messages", { chatId });
    return (rows ?? []).map(fromStored);
  }
  const rows = await idbLoadByChat(chatId);
  return rows.map(fromStored);
}
