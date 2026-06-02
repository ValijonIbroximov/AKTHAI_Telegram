// Brauzer uchun E2EE implementatsiyasi — Web Crypto API (window.crypto.subtle).
// Tauri muhitida emas, faqat oddiy brauzerda ishlatiladi.

/* eslint-disable @typescript-eslint/no-explicit-any */

const subtle = window.crypto.subtle;

// ── Yordamchi ──────────────────────────────────────────────────────────────

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
  const k = await subtle.importKey("raw", ab(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, ab(data)));
}

async function hkdfDerive(
  ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array, len: number
): Promise<Uint8Array> {
  const base = await subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt ? ab(salt) : new ArrayBuffer(32),
      info: ab(info),
    },
    base,
    len * 8
  );
  return new Uint8Array(bits);
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────

async function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
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

async function aesGcmDecrypt(key: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
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

// ── Ratchet KDF ────────────────────────────────────────────────────────────

const RATCHET_INFO  = new TextEncoder().encode("HarbiyMessenjer_DR_v1");
const X3DH_INFO     = new TextEncoder().encode("HarbiyMessenjer_X3DH_v1");
const AUTHOR_PEPPER = new TextEncoder().encode("Valijon Ibroximov");

async function kdfCk(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  return [
    await hmacSha256(chainKey, new Uint8Array([0x01])),
    await hmacSha256(chainKey, new Uint8Array([0x02])),
  ];
}

export async function kdfRk(rootKey: Uint8Array, dhOut: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdfDerive(dhOut, rootKey, RATCHET_INFO, 64);
  return [out.slice(0, 32), out.slice(32)];
}

// ── X25519 yordamchilari ────────────────────────────────────────────────────

async function x25519Gen(): Promise<CryptoKeyPair> {
  return subtle.generateKey(
    { name: "ECDH", namedCurve: "X25519" } as any,
    true,
    ["deriveBits"]
  ) as unknown as CryptoKeyPair;
}

async function x25519Dh(sk: CryptoKey, pkRaw: Uint8Array): Promise<Uint8Array> {
  const pk = await subtle.importKey("raw", ab(pkRaw), { name: "ECDH", namedCurve: "X25519" } as any, true, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pk } as any, sk, 256);
  return new Uint8Array(bits);
}

async function exportPkRaw(pk: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey("raw", pk));
}

// ── IndexedDB sessiya va kalit saqlash ────────────────────────────────────

interface WebSession { sendCk: string; recvCk: string; }

interface WebIdentity {
  ikPkB64: string;     // X25519 ochiq kalit Base64
  ikSkJwk: JsonWebKey; // X25519 maxfiy kalit JWK formatida
}

const IDB_NAME = "harbiy-signal";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "peerId" });
      if (!db.objectStoreNames.contains("identity"))
        db.createObjectStore("identity", { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openIdb();
  return new Promise((res) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => res((req.result as T) ?? null);
    req.onerror   = () => res(null);
  });
}

async function idbPut(store: string, value: object): Promise<void> {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function getSession(peerId: string): Promise<WebSession | null> {
  return idbGet<WebSession & { peerId: string }>("sessions", peerId);
}

async function saveSession(peerId: string, sess: WebSession): Promise<void> {
  return idbPut("sessions", { peerId, ...sess });
}

async function getIdentity(): Promise<WebIdentity | null> {
  return idbGet<WebIdentity & { id: string }>("identity", "self");
}

async function saveIdentity(ident: WebIdentity): Promise<void> {
  return idbPut("identity", { id: "self", ...ident });
}

// ── Kalit importi (JWK → CryptoKey) ────────────────────────────────────────

async function importSkFromJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey(
    "jwk", jwk,
    { name: "ECDH", namedCurve: "X25519" } as any,
    true, ["deriveBits"]
  );
}

// ── Browser kalit generatsiyasi va server yuklamasi ──────────────────────────

export async function webInitSignalKeys(token: string): Promise<void> {
  // Allaqachon generatsiya qilingan bo'lsa o'tkazib yuboriladi
  const existing = await getIdentity();
  if (existing) return;

  // X25519 identifikatsiya kalit juftligi
  const ikKp = await x25519Gen();
  const ikPkRaw = await exportPkRaw(ikKp.publicKey!);
  const ikSkJwk = await subtle.exportKey("jwk", ikKp.privateKey!) as JsonWebKey;

  await saveIdentity({ ikPkB64: b64(ab(ikPkRaw)), ikSkJwk });

  // X25519 imzolangan prekey
  const spkKp = await x25519Gen();
  const spkPkRaw = await exportPkRaw(spkKp.publicKey!);
  const spkSkJwk = await subtle.exportKey("jwk", spkKp.privateKey!) as JsonWebKey;
  await idbPut("identity", { id: "spk", pkB64: b64(ab(spkPkRaw)), skJwk: spkSkJwk });

  // Bir martalik prekey lar
  const otpks: { key_id: number; public_key: string }[] = [];
  for (let i = 1; i <= 5; i++) {
    const kp = await x25519Gen();
    const pk = await exportPkRaw(kp.publicKey!);
    const sk = await subtle.exportKey("jwk", kp.privateKey!) as JsonWebKey;
    await idbPut("identity", { id: `otpk_${i}`, pkB64: b64(ab(pk)), skJwk: sk });
    otpks.push({ key_id: i, public_key: b64(ab(pk)) });
  }

  // Serverga yuklash — dummy imzo (nol baytlar)
  const dummySig = b64(new ArrayBuffer(64)); // 64 ta nol bayt

  const bundle = {
    registration_id: (Math.random() * 16380 + 1) | 0,
    identity_key:    b64(ab(ikPkRaw)),
    signed_prekey: {
      key_id:     1,
      public_key: b64(ab(spkPkRaw)),
      signature:  dummySig,
    },
    one_time_prekeys: otpks,
  };

  await fetch("/api/v1/keys/upload", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify(bundle),
  });
}

// ── Browser identifikatsiya kaliti ─────────────────────────────────────────

export async function getWebIdentityPublicKeyB64(): Promise<string> {
  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti topilmadi — avval webInitSignalKeys chaqiring");
  return ident.ikPkB64;
}

// ── X3DH Sessiya o'rnatish (brauzer, yuboruvchi tomoni) ────────────────────

export interface WebEstablishResult {
  ekPk:          string;  // Efemer ochiq kalit Base64
  senderIkX25519: string; // Bizning IK X25519 Base64
  spkKeyId:      number;
  otpkKeyId:     number;
}

export async function webEstablishSession(
  peerId:     string,
  bundleJson: string
): Promise<WebEstablishResult> {
  const bundle = JSON.parse(bundleJson) as {
    identity_key:    string;
    signed_prekey:   { key_id: number; public_key: string };
    one_time_prekey?: { key_id: number; public_key: string };
  };

  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti topilmadi");

  const ourIkSk = await importSkFromJwk(ident.ikSkJwk);
  const ourIkPk = fromb64(ident.ikPkB64);

  const peerIkPk  = fromb64(bundle.identity_key);
  const peerSpkPk = fromb64(bundle.signed_prekey.public_key);

  // Efemer kalit juftligi
  const ekKp  = await x25519Gen();
  const ekPk  = await exportPkRaw(ekKp.publicKey!);

  // DH1=DH(IK_A, SPK_B), DH2=DH(EK_A, IK_B), DH3=DH(EK_A, SPK_B)
  const dh1 = await x25519Dh(ourIkSk, peerSpkPk);
  const dh2 = await x25519Dh(ekKp.privateKey!, peerIkPk);
  const dh3 = await x25519Dh(ekKp.privateKey!, peerSpkPk);

  const FF = new Uint8Array(32).fill(0xFF);
  let ikm = new Uint8Array([...FF, ...dh1, ...dh2, ...dh3]);

  let otpkKeyId = 0;
  if (bundle.one_time_prekey) {
    const peerOtpk = fromb64(bundle.one_time_prekey.public_key);
    const dh4 = await x25519Dh(ekKp.privateKey!, peerOtpk);
    ikm = new Uint8Array([...ikm, ...dh4]);
    otpkKeyId = bundle.one_time_prekey.key_id;
  }

  ikm = new Uint8Array([...ikm, ...AUTHOR_PEPPER]);

  const sk = await hkdfDerive(ikm, null, X3DH_INFO, 32);

  await saveSession(peerId, { sendCk: b64(ab(sk)), recvCk: b64(ab(sk)) });

  return {
    ekPk:          b64(ab(ekPk)),
    senderIkX25519: b64(ab(ourIkPk)),
    spkKeyId:      bundle.signed_prekey.key_id,
    otpkKeyId,
  };
}

// ── X3DH Sessiya o'rnatish (brauzer, qabul qiluvchi tomoni) ───────────────

export async function webEstablishSessionReceiver(
  peerId:          string,
  peerEkPkB64:     string,    // Yuboruvchining efemer ochiq kaliti
  senderIkX25519B64: string,  // Yuboruvchining IK X25519 shaklida
  spkKeyId:        number,
  _otpkKeyId:      number
): Promise<void> {
  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti topilmadi");

  const spkData = await idbGet<{ id: string; pkB64: string; skJwk: JsonWebKey }>("identity", "spk");
  if (!spkData) throw new Error("SPK kaliti topilmadi");

  void spkKeyId; // hozircha bitta SPK bor

  const ourIkSk  = await importSkFromJwk(ident.ikSkJwk);
  const ourSpkSk = await importSkFromJwk(spkData.skJwk);

  const peerIkPk = fromb64(senderIkX25519B64);
  const peerEkPk = fromb64(peerEkPkB64);

  // DH1=DH(SPK_B, IK_A), DH2=DH(IK_B, EK_A), DH3=DH(SPK_B, EK_A)
  const dh1 = await x25519Dh(ourSpkSk, peerIkPk);
  const dh2 = await x25519Dh(ourIkSk,  peerEkPk);
  const dh3 = await x25519Dh(ourSpkSk, peerEkPk);

  const FF = new Uint8Array(32).fill(0xFF);
  const ikm = new Uint8Array([...FF, ...dh1, ...dh2, ...dh3, ...AUTHOR_PEPPER]);

  const sk = await hkdfDerive(ikm, null, X3DH_INFO, 32);
  await saveSession(peerId, { sendCk: b64(ab(sk)), recvCk: b64(ab(sk)) });
}

// ── Xabar shifrlash/ochish ─────────────────────────────────────────────────

export async function webEncryptMessage(
  peerId:    string,
  plaintext: string
): Promise<string> {
  const sess = await getSession(peerId);
  if (!sess) throw new Error(`Sessiya topilmadi (${peerId}) — avval X3DH bajariling`);

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
  if (!sess) throw new Error(`Sessiya topilmadi (${peerId}) — avval X3DH bajariling`);

  const ck = fromb64(sess.recvCk);
  const [mk, nextCk] = await kdfCk(ck);

  const aad = new TextEncoder().encode(peerId);
  const ct  = fromb64(ciphertext);
  const pt  = await aesGcmDecrypt(mk, ct, aad);

  await saveSession(peerId, { ...sess, recvCk: b64(ab(nextCk)) });
  return new TextDecoder().decode(pt);
}
