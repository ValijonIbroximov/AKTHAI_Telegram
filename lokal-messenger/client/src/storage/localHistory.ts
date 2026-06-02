// Mahalliy ochiq matn tarixi — E2EE qoidasiga ko'ra serverda faqat shifrlangan.
// Brauzer: IndexedDB | Tauri: SQLite (signal.db)

import type { Message } from "@/types";
import { isTauri } from "@/crypto/adapter";

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

const IDB_NAME    = "harbiy-signal";
const IDB_VERSION = 4;
const STORE       = "message_history";

function toStored(m: Message): StoredMessage | null {
  if (!m.plaintext?.trim()) return null;
  if (m.plaintext.startsWith("⚠")) return null;
  return {
    id:         m.id,
    chat_id:    m.chat_id,
    sender_id:  m.sender_id,
    plaintext:  m.plaintext,
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
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
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

// ── Umumiy API ──────────────────────────────────────────────────────────────

/** Muvaffaqiyatli deshifrlangan yoki yuborilgan xabarni mahalliy bazaga yozadi */
export async function persistLocalMessage(msg: Message): Promise<void> {
  const row = toStored(msg);
  if (!row) return;

  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("save_local_message", { msg: row });
    return;
  }
  await idbSaveMessage(row);
}

/** Suhbat tarixini mahalliy bazadan o'qish (refresh dan keyin birinchi manba) */
export async function loadLocalMessages(chatId: string): Promise<Message[]> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const rows = await invoke<StoredMessage[]>("load_local_messages", { chatId });
    return (rows ?? []).map(fromStored);
  }
  const rows = await idbLoadByChat(chatId);
  return rows.map(fromStored);
}

/** Server va mahalliy ro'yxatlarni birlashtirish (id bo'yicha, ochiq matn ustun) */
export function mergeMessages(local: Message[], remote: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const m of remote) map.set(m.id, m);
  for (const m of local) {
    const ex = map.get(m.id);
    if (!ex || (m.plaintext && !m.plaintext.startsWith("⚠"))) {
      map.set(m.id, ex ? { ...ex, plaintext: m.plaintext ?? ex.plaintext } : m);
    }
  }
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
