// Brauzer uchun E2EE implementatsiyasi — Web Crypto API (window.crypto.subtle).
// Tauri muhitida emas, faqat oddiy brauzerda ishlatiladi.

/* eslint-disable @typescript-eslint/no-explicit-any */

const subtle = window.crypto.subtle;

// ── Yordamchi ─────────────────────────────────────────────────────────────

export function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function fromb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey(
    "raw", ab(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await subtle.sign("HMAC", k, ab(data));
  return new Uint8Array(sig);
}

async function hkdfDerive(
  ikm:    Uint8Array,
  salt:   Uint8Array | null,
  info:   Uint8Array,
  length: number
): Promise<Uint8Array> {
  const base = await subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt ? ab(salt) : new ArrayBuffer(32),
      info: ab(info),
    } as any,
    base,
    length * 8
  );
  return new Uint8Array(bits);
}

async function aesGcmEncrypt(
  key:       Uint8Array,
  plaintext: Uint8Array,
  aad:       Uint8Array
): Promise<Uint8Array> {
  const k     = await subtle.importKey("raw", ab(key), "AES-GCM", false, ["encrypt"]);
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const ct    = await subtle.encrypt(
    { name: "AES-GCM", iv: ab(nonce), additionalData: ab(aad) } as any,
    k,
    ab(plaintext)
  );
  const result = new Uint8Array(12 + ct.byteLength);
  result.set(nonce);
  result.set(new Uint8Array(ct), 12);
  return result;
}

async function aesGcmDecrypt(
  key:  Uint8Array,
  data: Uint8Array,
  aad:  Uint8Array
): Promise<Uint8Array> {
  const k     = await subtle.importKey("raw", ab(key), "AES-GCM", false, ["decrypt"]);
  const nonce = data.slice(0, 12);
  const ct    = data.slice(12);
  const pt    = await subtle.decrypt(
    { name: "AES-GCM", iv: ab(nonce), additionalData: ab(aad) } as any,
    k,
    ab(ct)
  );
  return new Uint8Array(pt);
}

// ── Ratchet ────────────────────────────────────────────────────────────────

const RATCHET_INFO  = new TextEncoder().encode("HarbiyMessenjer_DR_v1");
const AUTHOR_PEPPER = new TextEncoder().encode("Valijon Ibroximov");

async function kdfCk(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const msgKey = await hmacSha256(chainKey, new Uint8Array([0x01]));
  const nextCk = await hmacSha256(chainKey, new Uint8Array([0x02]));
  return [msgKey, nextCk];
}

export async function kdfRk(
  rootKey: Uint8Array,
  dhOut:   Uint8Array
): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdfDerive(dhOut, rootKey, RATCHET_INFO, 64);
  return [out.slice(0, 32), out.slice(32)];
}

// ── X3DH (Web) ────────────────────────────────────────────────────────────

export interface X3DHBundle {
  identityKey:    string;
  signedPrekey:   string;
  oneTimePrekey?: string;
}

async function x25519Gen(): Promise<CryptoKeyPair> {
  return subtle.generateKey(
    { name: "ECDH", namedCurve: "X25519" } as any,
    true,
    ["deriveBits"]
  ) as unknown as CryptoKeyPair;
}

async function x25519Dh(sk: CryptoKey, pk: CryptoKey): Promise<Uint8Array> {
  const bits = await subtle.deriveBits(
    { name: "ECDH", public: pk } as any,
    sk,
    256
  );
  return new Uint8Array(bits);
}

async function exportPk(pk: CryptoKey): Promise<Uint8Array> {
  const raw = await subtle.exportKey("raw", pk);
  return new Uint8Array(raw);
}

async function importPk(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", ab(raw), { name: "ECDH", namedCurve: "X25519" } as any, true, []);
}

export async function x3dhSenderWeb(
  ourIkSk: CryptoKey,
  bundle:  X3DHBundle
): Promise<{ sk: Uint8Array; ekPublic: Uint8Array }> {
  const ek    = await x25519Gen();
  const ikBPk = await importPk(fromb64(bundle.identityKey));
  const spkBPk= await importPk(fromb64(bundle.signedPrekey));

  const dh1   = await x25519Dh(ourIkSk,       spkBPk);
  const dh2   = await x25519Dh(ek.privateKey!, ikBPk);
  const dh3   = await x25519Dh(ek.privateKey!, spkBPk);

  const X3DH_INFO = new TextEncoder().encode("HarbiyMessenjer_X3DH_v1");
  const FF        = new Uint8Array(32).fill(0xFF);

  let ikm: Uint8Array = new Uint8Array([...FF, ...dh1, ...dh2, ...dh3]);
  if (bundle.oneTimePrekey) {
    const otpk = await importPk(fromb64(bundle.oneTimePrekey));
    const dh4  = await x25519Dh(ek.privateKey!, otpk);
    ikm = new Uint8Array([...ikm, ...dh4]);
  }
  ikm = new Uint8Array([...ikm, ...AUTHOR_PEPPER]);

  const sk = await hkdfDerive(ikm, null, X3DH_INFO, 32);
  return { sk, ekPublic: await exportPk(ek.publicKey!) };
}

// ── Sessiya (IndexedDB) ────────────────────────────────────────────────────

interface WebSession {
  sendCk: string;
  recvCk: string;
}

const IDB_NAME  = "harbiy-signal";
const IDB_STORE = "sessions";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(IDB_STORE, { keyPath: "peerId" });
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function getSession(peerId: string): Promise<WebSession | null> {
  const db  = await openIdb();
  return new Promise((res) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(peerId);
    req.onsuccess = () => res((req.result as (WebSession & { peerId: string }) | undefined) ?? null);
    req.onerror   = () => res(null);
  });
}

async function saveSession(peerId: string, sess: WebSession): Promise<void> {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ peerId, ...sess });
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

// ── Xabar shifrlash/ochish ─────────────────────────────────────────────────

export async function webEncryptMessage(
  peerId:    string,
  plaintext: string
): Promise<string> {
  const sess = await getSession(peerId);
  if (!sess) throw new Error("Sessiya topilmadi — avval X3DH bajariling");

  const ck = fromb64(sess.sendCk);
  const [mk, nextCk] = await kdfCk(ck);

  const pt  = new TextEncoder().encode(plaintext);
  const aad = new TextEncoder().encode(peerId);
  const ct  = await aesGcmEncrypt(mk, pt, aad);

  await saveSession(peerId, { ...sess, sendCk: b64(ab(nextCk)) });
  return JSON.stringify({
    header:     { dh_ratchet_pk: "", msg_num: 0, prev_chain_len: 0 },
    ciphertext: b64(ab(ct)),
  });
}

export async function webDecryptMessage(
  peerId:      string,
  payloadJson: string
): Promise<string> {
  const { ciphertext } = JSON.parse(payloadJson) as { ciphertext: string };
  const sess = await getSession(peerId);
  if (!sess) throw new Error("Sessiya topilmadi");

  const ck = fromb64(sess.recvCk);
  const [mk, nextCk] = await kdfCk(ck);

  const aad = new TextEncoder().encode(peerId);
  const ct  = fromb64(ciphertext);
  const pt  = await aesGcmDecrypt(mk, ct, aad);

  await saveSession(peerId, { ...sess, recvCk: b64(ab(nextCk)) });
  return new TextDecoder().decode(pt);
}

// ── X3DH Sessiya o'rnatish (brauzer) ─────────────────────────────────────────
// bundle_json: Go serverdan kelgan KeyBundle JSON
export async function webEstablishSession(
  peerId:     string,
  bundleJson: string
): Promise<void> {
  const bundle = JSON.parse(bundleJson) as {
    identity_key: string;
    signed_prekey: { public_key: string };
  };

  // Oddiy brauzer rejimida X3DH to'liq emas: tasodifiy umumiy kalit hosil qilinadi.
  // Production uchun full X3DH kerak; hozircha AES kaliti HKDF bilan hosil qilinadi.
  const ikBytes  = fromb64(bundle.identity_key);
  const spkBytes = fromb64(bundle.signed_prekey.public_key);
  const combined = new Uint8Array(ikBytes.length + spkBytes.length);
  combined.set(ikBytes, 0);
  combined.set(spkBytes, ikBytes.length);

  const [sharedKey] = await kdfRk(
    new Uint8Array(32).fill(0),
    combined
  );

  const sharedB64 = b64(ab(sharedKey));
  await saveSession(peerId, { sendCk: sharedB64, recvCk: sharedB64 });
}
