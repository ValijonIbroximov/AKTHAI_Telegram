// Brauzer uchun E2EE implementatsiyasi.
//
// X25519 DH  → @noble/curves/ed25519  (barcha brauzerlarda ishlaydi)
// AES-256-GCM, HKDF, HMAC → Web Crypto API (keng qo'llab-quvvatlanadi)
//
// Tauri muhitida ISHLATILMAYDI — faqat oddiy brauzer uchun.

import { x25519 } from "@noble/curves/ed25519.js";

// ── Yordamchi ──────────────────────────────────────────────────────────────

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...u));
}

export function fromb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

const subtle = window.crypto.subtle;

// ── HMAC-SHA256 ────────────────────────────────────────────────────────────

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", toAB(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, toAB(data)));
}

// ── HKDF-SHA256 ────────────────────────────────────────────────────────────

async function hkdf(
  ikm:  Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  len:  number
): Promise<Uint8Array> {
  const base = await subtle.importKey("raw", toAB(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt ? toAB(salt) : new ArrayBuffer(32),
      info: toAB(info),
    },
    base,
    len * 8
  );
  return new Uint8Array(bits);
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────

async function aesEncrypt(
  key: Uint8Array, pt: Uint8Array, aad: Uint8Array
): Promise<Uint8Array> {
  const k     = await subtle.importKey("raw", toAB(key), "AES-GCM", false, ["encrypt"]);
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const ct    = await subtle.encrypt(
    { name: "AES-GCM", iv: toAB(nonce), additionalData: toAB(aad) },
    k,
    toAB(pt)
  );
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(nonce);
  out.set(new Uint8Array(ct), 12);
  return out;
}

async function aesDecrypt(
  key: Uint8Array, data: Uint8Array, aad: Uint8Array
): Promise<Uint8Array> {
  const k     = await subtle.importKey("raw", toAB(key), "AES-GCM", false, ["decrypt"]);
  const nonce = data.slice(0, 12);
  const ct    = data.slice(12);
  const pt    = await subtle.decrypt(
    { name: "AES-GCM", iv: toAB(nonce), additionalData: toAB(aad) },
    k,
    toAB(ct)
  );
  return new Uint8Array(pt);
}

// ── Ratchet KDF konstantalari ──────────────────────────────────────────────

const RATCHET_INFO  = new TextEncoder().encode("HarbiyMessenjer_DR_v1");
const X3DH_INFO     = new TextEncoder().encode("HarbiyMessenjer_X3DH_v1");
const AUTHOR_PEPPER = new TextEncoder().encode("Valijon Ibroximov");

async function kdfCk(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  return [
    await hmacSha256(chainKey, new Uint8Array([0x01])),
    await hmacSha256(chainKey, new Uint8Array([0x02])),
  ];
}

export async function kdfRk(
  rootKey: Uint8Array,
  dhOut:   Uint8Array
): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdf(dhOut, rootKey, RATCHET_INFO, 64);
  return [out.slice(0, 32), out.slice(32)];
}

// ── X25519 (@noble/curves) ─────────────────────────────────────────────────

function genX25519(): { sk: Uint8Array; pk: Uint8Array } {
  const kp = x25519.keygen();
  return { sk: kp.secretKey, pk: kp.publicKey };
}

function dhX25519(sk: Uint8Array, theirPk: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(sk, theirPk);
}

// ── IndexedDB ─────────────────────────────────────────────────────────────

interface WebSession { sendCk: string; recvCk: string; }

interface WebIdentity {
  ikSkB64: string;  // X25519 maxfiy kalit Base64
  ikPkB64: string;  // X25519 ochiq kalit Base64
}

const IDB_NAME = "harbiy-signal";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 3);
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
    req.onsuccess = () => res(req.result ? (req.result as T) : null);
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
  return idbGet<WebSession>("sessions", peerId);
}

async function saveSession(peerId: string, sess: WebSession): Promise<void> {
  return idbPut("sessions", { peerId, ...sess });
}

async function getIdentity(): Promise<WebIdentity | null> {
  return idbGet<WebIdentity>("identity", "self");
}

// ── Kalit generatsiyasi va server yuklamasi ────────────────────────────────

export async function webInitSignalKeys(token: string): Promise<void> {
  // Allaqachon generatsiya qilinganmi?
  const existing = await getIdentity();
  if (existing) {
    console.log("[WebCrypto] Kalit allaqachon mavjud, yuklash o'tkazib yuborildi");
    return;
  }

  // Identifikatsiya kalit juftligi (X25519)
  const ik = genX25519();
  await idbPut("identity", {
    id:      "self",
    ikSkB64: b64(ik.sk),
    ikPkB64: b64(ik.pk),
  } satisfies WebIdentity & { id: string });

  // Imzolangan prekey (X25519)
  const spk = genX25519();
  await idbPut("identity", { id: "spk", skB64: b64(spk.sk), pkB64: b64(spk.pk) });

  // Bir martalik prekey'lar (5 ta)
  const otpks: { key_id: number; public_key: string }[] = [];
  for (let i = 1; i <= 5; i++) {
    const k = genX25519();
    await idbPut("identity", { id: `otpk_${i}`, skB64: b64(k.sk), pkB64: b64(k.pk) });
    otpks.push({ key_id: i, public_key: b64(k.pk) });
  }

  // Server'ga yuklash — imzo sifatida 64 ta nol (Rust tomonida dummy sifatida qabul qilinadi)
  const dummySig = b64(new Uint8Array(64));

  const bundle = {
    registration_id: ((Math.random() * 16380) | 0) + 1,
    identity_key:    b64(ik.pk),
    signed_prekey: {
      key_id:     1,
      public_key: b64(spk.pk),
      signature:  dummySig,
    },
    one_time_prekeys: otpks,
  };

  const resp = await fetch("/api/v1/keys/upload", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify(bundle),
  });

  if (resp.ok || resp.status === 204) {
    console.log("[WebCrypto] Kalit bundle serverga yuklandi");
  } else {
    console.error("[WebCrypto] Kalit yuklash xatoligi:", resp.status);
  }
}

// ── Identifikatsiya ochiq kaliti ───────────────────────────────────────────

export async function getWebIdentityPublicKeyB64(): Promise<string> {
  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti yo'q — avval webInitSignalKeys chaqiring");
  return ident.ikPkB64;
}

// ── X3DH umumiy kalit hisoblash ────────────────────────────────────────────

async function x3dhKdf(
  dh1: Uint8Array, dh2: Uint8Array, dh3: Uint8Array,
  dh4?: Uint8Array
): Promise<Uint8Array> {
  const FF  = new Uint8Array(32).fill(0xFF);
  const parts = [FF, dh1, dh2, dh3];
  if (dh4) parts.push(dh4);
  parts.push(AUTHOR_PEPPER);
  const ikm = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { ikm.set(p, off); off += p.length; }
  return hkdf(ikm, null, X3DH_INFO, 32);
}

// ── X3DH Sessiya o'rnatish (yuboruvchi tomoni) ─────────────────────────────

export interface WebEstablishResult {
  ekPk:           string;
  senderIkX25519: string;
  spkKeyId:       number;
  otpkKeyId:      number;
}

export async function webEstablishSession(
  peerId:     string,
  bundleJson: string
): Promise<WebEstablishResult> {
  const bundle = JSON.parse(bundleJson) as {
    identity_key:     string;
    signed_prekey:    { key_id: number; public_key: string };
    one_time_prekey?: { key_id: number; public_key: string };
  };

  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti yo'q");

  const ourIkSk  = fromb64(ident.ikSkB64);
  const ourIkPk  = fromb64(ident.ikPkB64);

  const peerIkPk  = fromb64(bundle.identity_key);
  const peerSpkPk = fromb64(bundle.signed_prekey.public_key);

  // Efemer kalit juftligi
  const ek = genX25519();

  // DH1=DH(IK_A, SPK_B), DH2=DH(EK_A, IK_B), DH3=DH(EK_A, SPK_B)
  const dh1 = dhX25519(ourIkSk, peerSpkPk);
  const dh2 = dhX25519(ek.sk,   peerIkPk);
  const dh3 = dhX25519(ek.sk,   peerSpkPk);

  let dh4: Uint8Array | undefined;
  let otpkKeyId = 0;
  if (bundle.one_time_prekey) {
    dh4       = dhX25519(ek.sk, fromb64(bundle.one_time_prekey.public_key));
    otpkKeyId = bundle.one_time_prekey.key_id;
  }

  const sk = await x3dhKdf(dh1, dh2, dh3, dh4);
  await saveSession(peerId, { sendCk: b64(sk), recvCk: b64(sk) });

  console.log(`[WebCrypto] X3DH sender sessiya o'rnatildi: ${peerId}`);

  return {
    ekPk:           b64(ek.pk),
    senderIkX25519: b64(ourIkPk),
    spkKeyId:       bundle.signed_prekey.key_id,
    otpkKeyId,
  };
}

// ── X3DH Sessiya o'rnatish (qabul qiluvchi tomoni) ────────────────────────

export async function webEstablishSessionReceiver(
  peerId:            string,
  peerEkPkB64:       string,
  senderIkX25519B64: string,
  _spkKeyId:         number,
  _otpkKeyId:        number
): Promise<void> {
  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti yo'q");

  const spkData = await idbGet<{ id: string; skB64: string; pkB64: string }>("identity", "spk");
  if (!spkData) throw new Error("SPK kaliti yo'q");

  const ourIkSk  = fromb64(ident.ikSkB64);
  const ourSpkSk = fromb64(spkData.skB64);

  const senderIkPk = fromb64(senderIkX25519B64);
  const peerEkPk   = fromb64(peerEkPkB64);

  // DH1=DH(SPK_B, IK_A), DH2=DH(IK_B, EK_A), DH3=DH(SPK_B, EK_A)
  const dh1 = dhX25519(ourSpkSk, senderIkPk);
  const dh2 = dhX25519(ourIkSk,  peerEkPk);
  const dh3 = dhX25519(ourSpkSk, peerEkPk);

  const sk = await x3dhKdf(dh1, dh2, dh3);
  await saveSession(peerId, { sendCk: b64(sk), recvCk: b64(sk) });

  console.log(`[WebCrypto] X3DH receiver sessiya o'rnatildi: ${peerId}`);
}

// ── Xabar shifrlash ────────────────────────────────────────────────────────

export async function webEncryptMessage(
  peerId:    string,
  plaintext: string
): Promise<string> {
  const sess = await getSession(peerId);
  if (!sess) throw new Error(`Sessiya yo'q (${peerId}) — avval X3DH bajaring`);

  const ck          = fromb64(sess.sendCk);
  const [mk, nextCk] = await kdfCk(ck);

  const pt  = new TextEncoder().encode(plaintext);
  const aad = new TextEncoder().encode(peerId);
  const ct  = await aesEncrypt(mk, pt, aad);

  await saveSession(peerId, { ...sess, sendCk: b64(nextCk) });

  return JSON.stringify({
    header:     { dh_ratchet_pk: "", msg_num: 0, prev_chain_len: 0 },
    ciphertext: b64(ct),
  });
}

// ── Xabar shifr ochish ─────────────────────────────────────────────────────

export async function webDecryptMessage(
  peerId:      string,
  payloadJson: string
): Promise<string> {
  const { ciphertext } = JSON.parse(payloadJson) as { ciphertext: string };
  const sess = await getSession(peerId);
  if (!sess) throw new Error(`Sessiya yo'q (${peerId}) — avval X3DH bajaring`);

  const ck          = fromb64(sess.recvCk);
  const [mk, nextCk] = await kdfCk(ck);

  const aad = new TextEncoder().encode(peerId);
  const ct  = fromb64(ciphertext);
  const pt  = await aesDecrypt(mk, ct, aad);

  await saveSession(peerId, { ...sess, recvCk: b64(nextCk) });

  return new TextDecoder().decode(pt);
}
