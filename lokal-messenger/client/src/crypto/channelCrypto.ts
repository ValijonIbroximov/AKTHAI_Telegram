// Kanal xabarlari uchun AES-256-GCM shifrlash.
// Har bir kanal uchun kalit yaratuvchi qurilmada saqlanadi.
import { fcToB64, fcFromB64 } from "@/crypto/fileCrypto";

/** Server va mijoz o'rtasidagi kanal xabar turi */
export const CHANNEL_MSG_TYPE = 10;

const STORAGE_PREFIX = "lokal-channel-keys:";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readKeyMap(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeKeyMap(userId: string, map: Record<string, string>): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(map));
}

export function initChannelKey(userId: string, chatId: string): void {
  const map = readKeyMap(userId);
  if (map[chatId]) return;
  const key = crypto.getRandomValues(new Uint8Array(32));
  map[chatId] = fcToB64(key);
  writeKeyMap(userId, map);
}

export function getChannelKey(userId: string, chatId: string): Uint8Array | null {
  const b64 = readKeyMap(userId)[chatId];
  if (!b64) return null;
  try {
    return fcFromB64(b64);
  } catch {
    return null;
  }
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  const buf = new Uint8Array(raw).buffer as ArrayBuffer;
  return crypto.subtle.importKey("raw", buf, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptChannelPayload(
  userId: string,
  chatId: string,
  plaintext: string,
): Promise<string> {
  const keyBytes = getChannelKey(userId, chatId);
  if (!keyBytes) throw new Error("Kanal shifrlash kaliti topilmadi");

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await importAesKey(keyBytes);
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv).buffer as ArrayBuffer },
    aesKey,
    encoded,
  );

  return JSON.stringify({
    v: 1,
    iv: fcToB64(iv),
    ct: fcToB64(new Uint8Array(encrypted)),
  });
}

export async function decryptChannelPayload(
  userId: string,
  chatId: string,
  ciphertext: string,
): Promise<string> {
  const keyBytes = getChannelKey(userId, chatId);
  if (!keyBytes) throw new Error("Kanal shifrlash kaliti topilmadi");

  let parsed: { iv?: string; ct?: string };
  try {
    parsed = JSON.parse(ciphertext) as { iv?: string; ct?: string };
  } catch {
    throw new Error("Kanal ciphertext noto'g'ri");
  }
  if (!parsed.iv || !parsed.ct) throw new Error("Kanal ciphertext to'liq emas");

  const iv = fcFromB64(parsed.iv);
  const ct = fcFromB64(parsed.ct);
  const aesKey = await importAesKey(keyBytes);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv).buffer as ArrayBuffer },
    aesKey,
    new Uint8Array(ct).buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(decrypted);
}

export function isChannelMsgType(n: number): boolean {
  return n === CHANNEL_MSG_TYPE;
}
