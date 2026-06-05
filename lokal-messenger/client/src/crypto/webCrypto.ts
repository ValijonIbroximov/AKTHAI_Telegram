// Brauzer uchun E2EE implementatsiyasi.
//
// X25519 DH  → @noble/curves/ed25519  (barcha brauzerlarda ishlaydi)
// AES-256-GCM, HKDF, HMAC → Web Crypto API (keng qo'llab-quvvatlanadi)
//
// Tauri muhitida ISHLATILMAYDI — faqat oddiy brauzer uchun.

import { x25519 } from "@noble/curves/ed25519.js";
import { peerBundleIkToX25519 } from "./ikConvert";
import { DecryptError } from "./cryptoErrors";
import { scopedIdbName, getActiveCryptoUserId } from "./userScope";

// ── Yordamchi ──────────────────────────────────────────────────────────────

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...u));
}

export function fromb64(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const pad  = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  } catch (e) {
    throw new Error(`Base64 decode xatoligi: ${e instanceof Error ? e.message : e}`);
  }
}

/** JSON ichidagi ciphertext (nonce12 + body) ni ajratadi */
export function parseCipherBlob(cipherB64: string): {
  iv: Uint8Array;
  body: Uint8Array;
  total: number;
} {
  const ct = fromb64(cipherB64);
  if (ct.length < 28) {
    throw new Error(
      `IV/ciphertext juda qisqa: ${ct.length} bayt (min 28 = 12 nonce + 16 tag)`
    );
  }
  return { iv: ct.slice(0, 12), body: ct.slice(12), total: ct.length };
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

/** AES-GCM: nonce(12) + ciphertext + tag(16) — Rust bilan bir xil */
async function aesDecrypt(
  key: Uint8Array, data: Uint8Array, aad: Uint8Array
): Promise<Uint8Array> {
  if (data.length < 28) {
    throw new Error(`Shifrlangan ma'lumot juda qisqa (${data.length} bayt, min 28)`);
  }
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

interface WebSession {
  sendCk:     string;
  recvCk:     string;
  sendMsgNum: number;
  recvMsgNum: number;
  /** key_exchange orqali o'rnatilgan qabul sessiyasi — sender X3DH bilan ustiga yozilmasin */
  role?:      "sender" | "receiver";
}

interface WebIdentity {
  ikSkB64: string;  // X25519 maxfiy kalit Base64
  ikPkB64: string;  // X25519 ochiq kalit Base64
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(scopedIdbName(), 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "peerId" });
      if (!db.objectStoreNames.contains("identity"))
        db.createObjectStore("identity", { keyPath: "id" });
      if (!db.objectStoreNames.contains("message_history")) {
        const os = db.createObjectStore("message_history", { keyPath: "id" });
        os.createIndex("chat_id", "chat_id", { unique: false });
      }
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

async function idbClearStore(store: string): Promise<void> {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function getSession(peerId: string): Promise<WebSession | null> {
  const raw = await idbGet<WebSession & { peerId?: string }>("sessions", peerId);
  if (!raw) return null;
  return {
    sendCk:     raw.sendCk,
    recvCk:     raw.recvCk,
    sendMsgNum: raw.sendMsgNum ?? 0,
    recvMsgNum: raw.recvMsgNum ?? 0,
  };
}

async function saveSession(peerId: string, sess: WebSession): Promise<void> {
  return idbPut("sessions", { peerId, ...sess });
}

/** Qabul zanjirini header.msg_num ga moslab oldinga surish (Tauri ratchet bilan mos) */
async function advanceRecvChain(sess: WebSession, targetMsgNum: number): Promise<WebSession> {
  if (targetMsgNum < sess.recvMsgNum) {
    throw new DecryptError(
      "OUT_OF_ORDER",
      `Out-of-order: recvMsgNum=${sess.recvMsgNum}, kelgan msg_num=${targetMsgNum}`
    );
  }
  let { recvCk, recvMsgNum } = sess;
  while (recvMsgNum < targetMsgNum) {
    const ck = fromb64(recvCk);
    const [, nextCk] = await kdfCk(ck);
    recvCk = b64(nextCk);
    recvMsgNum++;
  }
  return { ...sess, recvCk, recvMsgNum };
}

async function getIdentity(): Promise<WebIdentity | null> {
  return idbGet<WebIdentity>("identity", "self");
}

// ── Sessiya mavjudligi ─────────────────────────────────────────────────────

export async function webHasSession(peerId: string): Promise<boolean> {
  const sess = await getSession(peerId);
  return sess !== null;
}

/** Berilgan peer bilan Signal sessiyasini o'chirish */
export async function webClearSession(peerId: string): Promise<void> {
  await idbDelete("sessions", peerId);
  console.log(`[WebCrypto] Sessiya tozalandi: peer=${peerId}`);
}

/** Barcha Signal sessiyalarini o'chirish (kalit qayta yaratilganda) */
export async function webClearAllSessions(): Promise<void> {
  await idbClearStore("sessions");
  console.log("[WebCrypto] Barcha sessiyalar tozalandi");
}

/** IndexedDB dagi barcha Signal sessiya peerId lari (debug / bootstrap) */
export async function webListSessionPeers(): Promise<string[]> {
  const db = await openIdb();
  return new Promise((res) => {
    const req = db.transaction("sessions", "readonly").objectStore("sessions").getAllKeys();
    req.onsuccess = () => res((req.result as string[]) ?? []);
    req.onerror   = () => res([]);
  });
}

/** Dastur yuklanganda: IDB ochiq, sessiyalar va identity mavjudligi */
export async function webEnsureCryptoReady(): Promise<void> {
  const peers = await webListSessionPeers();
  const ident = await getIdentity();
  console.log(
    `[WebCrypto] ✅ user=${getActiveCryptoUserId()} idb=${scopedIdbName()} ` +
    `identity=${ident ? "yes" : "no"} sessions=${peers.length}`,
    peers.length ? peers : ""
  );
}

// ── Kalit generatsiyasi va server yuklamasi ────────────────────────────────
//
// Login har safar chaqiriladi. IDB'da eski kalit bo'lsa ham server'ga
// qayta yuklanadi (UPSERT) — bu server DB reset yoki birinchi upload
// muvaffaqiyatsiz bo'lgan holatlarni qamrab oladi.
//
export interface KeyInitResult {
  regenerated: boolean;
}

export async function webInitSignalKeys(token: string): Promise<KeyInitResult> {
  // ── Identity Key: IDB'da bor bo'lsa ishlatiladi, yo'q bo'lsa yangi ──────
  let ikSk: Uint8Array, ikPk: Uint8Array;
  const existingIdent = await getIdentity();
  const existingSpk = await idbGet<{ id: string; keyId?: number; skB64: string; pkB64: string }>("identity", "spk");
  const regenerated = !existingIdent || !existingSpk;

  if (regenerated) {
    await webClearAllSessions();
    console.warn("[WebCrypto] ⚠ Kalitlar qayta yaratilmoqda — barcha sessiyalar tozalandi");
  }

  if (existingIdent) {
    ikSk = fromb64(existingIdent.ikSkB64);
    ikPk = fromb64(existingIdent.ikPkB64);
    console.log("[WebCrypto] IDB Identity Key mavjud, serverga qayta yuklanmoqda…");
  } else {
    const ik = genX25519();
    ikSk = ik.sk; ikPk = ik.pk;
    await idbPut("identity", { id: "self", ikSkB64: b64(ikSk), ikPkB64: b64(ikPk) });
    console.log("[WebCrypto] Yangi Identity Key yaratildi");
  }

  // ── Signed PreKey: qayta generatsiya yoki IDB'dan o'qish ───────────────
  let spkSk: Uint8Array, spkPk: Uint8Array;
  let spkKeyId = existingSpk?.keyId ?? 1;
  if (existingSpk && !regenerated) {
    spkSk = fromb64(existingSpk.skB64);
    spkPk = fromb64(existingSpk.pkB64);
  } else {
    const spk = genX25519();
    spkSk = spk.sk; spkPk = spk.pk;
    spkKeyId = regenerated ? ((Date.now() % 900_000) + 100_000) : (spkKeyId || 1);
    await idbPut("identity", { id: "spk", keyId: spkKeyId, skB64: b64(spkSk), pkB64: b64(spkPk) });
    console.log(`[WebCrypto] Yangi Signed PreKey yaratildi (key_id=${spkKeyId})`);
  }
  void spkSk;

  // ── One-Time PreKeys: doim yangi key_id bilan yuklanadi ────────────────
  // Timestamp asosida noyob offset — avvalgi (used=TRUE) kalit ID lari bilan
  // to'qnashuv bo'lmasligi uchun. Server: ON CONFLICT (user_id, key_id) DO NOTHING.
  const baseId = (Date.now() % 900_000) + 100_000; // 100000–999999
  const otpks: { key_id: number; public_key: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const keyId = baseId + i;
    const k = genX25519();
    // IDB'da key_id bo'yicha saqlanadi (webEstablishSessionReceiver qidirish uchun)
    await idbPut("identity", { id: `otpk_${keyId}`, skB64: b64(k.sk), pkB64: b64(k.pk) });
    otpks.push({ key_id: keyId, public_key: b64(k.pk) });
  }

  // ── Server'ga yuklash (UPSERT) ─────────────────────────────────────────
  const dummySig = b64(new Uint8Array(64));
  const bundle = {
    registration_id: ((Math.random() * 16380) | 0) + 1,
    identity_key:          b64(ikPk),
    identity_key_x25519:   b64(ikPk),
    force_overwrite:       regenerated,
    signed_prekey:   { key_id: spkKeyId, public_key: b64(spkPk), signature: dummySig },
    one_time_prekeys: otpks,
  };

  const BASE = import.meta.env.PROD ? "https://server.lokal:8443/api/v1" : "/api/v1";
  const resp = await fetch(`${BASE}/keys/upload`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify(bundle),
  });

  if (resp.ok || resp.status === 204) {
    console.log(
      `[WebCrypto] ✅ Kalit bundle serverga yuklandi (${otpks.length} OTPKs, ` +
      `baseId=${baseId}, force_overwrite=${regenerated})`
    );
  } else {
    const errBody = await resp.text().catch(() => "");
    console.error(`[WebCrypto] ❌ Kalit yuklash xatoligi: HTTP ${resp.status} — ${errBody}`);
    throw new Error(`Kalit yuklash muvaffaqiyatsiz: ${resp.status}`);
  }

  return { regenerated };
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
  const hadSession = await getSession(peerId);
  if (hadSession?.role === "receiver") {
    console.warn(
      `[WebCrypto] Qabul sessiyasi saqlanadi (receiver) — sender X3DH o'tkazib yuborildi: ${peerId}`
    );
    const ident = await getIdentity();
    if (!ident) throw new Error("Identifikatsiya kaliti yo'q");
    const ek = genX25519();
    return {
      ekPk:           b64(ek.pk),
      senderIkX25519: ident.ikPkB64,
      spkKeyId:       1,
      otpkKeyId:      0,
    };
  }

  const bundle = JSON.parse(bundleJson) as {
    identity_key:          string;
    identity_key_x25519?:  string;
    signed_prekey:         { key_id: number; public_key: string; signature?: string };
    one_time_prekey?:      { key_id: number; public_key: string };
  };

  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti yo'q");

  const ourIkSk  = fromb64(ident.ikSkB64);
  const ourIkPk  = fromb64(ident.ikPkB64);

  const peerIkPk  = bundle.identity_key_x25519
    ? fromb64(bundle.identity_key_x25519)
    : peerBundleIkToX25519(
        bundle.identity_key,
        bundle.signed_prekey.signature ?? b64(new Uint8Array(64))
      );
  if (peerIkPk.length !== 32) {
    throw new Error(`Peer IK X25519 32 bayt bo'lishi kerak: ${peerIkPk.length}`);
  }
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
  await saveSession(peerId, {
    sendCk: b64(sk), recvCk: b64(sk), sendMsgNum: 0, recvMsgNum: 0, role: "sender",
  });

  console.log(`[WebCrypto] ✅ X3DH sender sessiya o'rnatildi (IDB): ${peerId}`);

  return {
    ekPk:           b64(ek.pk),
    senderIkX25519: b64(ourIkPk),
    spkKeyId:       bundle.signed_prekey.key_id,
    otpkKeyId,
  };
}

// ── X3DH Sessiya o'rnatish (qabul qiluvchi tomoni) ────────────────────────
// Signal spec: DH1=DH(SPK_B,IK_A) DH2=DH(IK_B,EK_A) DH3=DH(SPK_B,EK_A)
//              DH4=DH(OTPK_B,EK_A)  ← agar sender OTPK ishlatgan bo'lsa

export async function webEstablishSessionReceiver(
  peerId:            string,
  peerEkPkB64:       string,
  senderIkX25519B64: string,
  spkKeyId:          number,
  otpkKeyId:         number
): Promise<void> {
  const ident = await getIdentity();
  if (!ident) throw new Error("Identifikatsiya kaliti yo'q — avval webInitSignalKeys chaqiring");

  const spkData = await idbGet<{ id: string; keyId?: number; skB64: string; pkB64: string }>("identity", "spk");
  if (!spkData) throw new Error("SPK kaliti yo'q IDB'da");
  if (spkKeyId > 0 && spkData.keyId && spkData.keyId !== spkKeyId) {
    console.warn(
      `[WebCrypto] SPK key_id mos kelmaydi (idb=${spkData.keyId}, ke=${spkKeyId}) — mavjud SPK ishlatiladi`
    );
  }

  const ourIkSk  = fromb64(ident.ikSkB64);
  const ourSpkSk = fromb64(spkData.skB64);

  // key_exchange: sender_ik_x25519 allaqachon X25519 (Tauri yoki brauzer)
  const senderIkPk = fromb64(senderIkX25519B64);
  if (senderIkPk.length !== 32) {
    throw new Error(`sender_ik_x25519 32 bayt bo'lishi kerak: ${senderIkPk.length}`);
  }
  const peerEkPk = fromb64(peerEkPkB64);
  if (peerEkPk.length !== 32) {
    throw new Error(`ek_pk 32 bayt bo'lishi kerak: ${peerEkPk.length}`);
  }

  // Signal X3DH receiver DH zanjiri
  const dh1 = dhX25519(ourSpkSk, senderIkPk);   // DH(SPK_B, IK_A)
  const dh2 = dhX25519(ourIkSk,  peerEkPk);      // DH(IK_B, EK_A)
  const dh3 = dhX25519(ourSpkSk, peerEkPk);      // DH(SPK_B, EK_A)

  // DH4: agar sender OTPK ishlatgan bo'lsa, xuddi shu OTPK SK'si IDB'dan olinadi
  let dh4: Uint8Array | undefined;
  if (otpkKeyId > 0) {
    const otpkData = await idbGet<{ id: string; skB64: string; pkB64: string }>(
      "identity", `otpk_${otpkKeyId}`
    );
    if (!otpkData) {
      throw new Error(
        `OTPK_${otpkKeyId} IDB'da topilmadi — X3DH kaliti noto'g'ri (login/refresh dan keyin qayta key_exchange kerak)`
      );
    }
    dh4 = dhX25519(fromb64(otpkData.skB64), peerEkPk);
    console.log(`[WebCrypto] OTPK_${otpkKeyId} ishlatildi (DH4)`);
  }

  const sk = await x3dhKdf(dh1, dh2, dh3, dh4);
  await saveSession(peerId, {
    sendCk: b64(sk), recvCk: b64(sk), sendMsgNum: 0, recvMsgNum: 0, role: "receiver",
  });

  console.log(`[WebCrypto] ✅ X3DH receiver sessiya o'rnatildi (IDB): ${peerId}`);
}

// Rust ratchet bilan bir xil header (AAD = serde JSON tartibida)
interface DrHeader {
  dh_ratchet_pk:  string;
  msg_num:        number;
  prev_chain_len: number;
}

function headerAad(h: DrHeader): Uint8Array {
  // Rust: serde_json::to_vec(&header) — maydon tartibi muhim
  return new TextEncoder().encode(
    JSON.stringify({
      dh_ratchet_pk:  h.dh_ratchet_pk,
      msg_num:        h.msg_num,
      prev_chain_len: h.prev_chain_len,
    })
  );
}

/** Server/WS dan kelgan ciphertext ni JSON payload ga normalizatsiya qiladi */
export function normalizePayload(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("{")) return t;
  try {
    const decoded = atob(t);
    if (decoded.trim().startsWith("{")) return decoded;
  } catch {
    /* xom JSON */
  }
  return t;
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

  const header: DrHeader = {
    dh_ratchet_pk:  "",
    msg_num:        sess.sendMsgNum,
    prev_chain_len: 0,
  };
  const pt  = new TextEncoder().encode(plaintext);
  const ct  = await aesEncrypt(mk, pt, headerAad(header));

  await saveSession(peerId, {
    ...sess,
    sendCk:     b64(nextCk),
    sendMsgNum: sess.sendMsgNum + 1,
  });

  return JSON.stringify({ header, ciphertext: b64(ct) });
}

// ── Xabar shifr ochish ─────────────────────────────────────────────────────

export async function webDecryptMessage(
  peerId:      string,
  payloadJson: string
): Promise<string> {
  const payload = normalizePayload(payloadJson);
  let val: { header?: DrHeader; ciphertext?: string };
  try {
    val = JSON.parse(payload);
  } catch (e) {
    throw new DecryptError(
      "PAYLOAD_JSON",
      `Payload JSON noto'g'ri: ${e instanceof Error ? e.message : e}`,
      e
    );
  }

  const header: DrHeader = val.header ?? {
    dh_ratchet_pk:  "",
    msg_num:        0,
    prev_chain_len: 0,
  };
  const cipherB64 = val.ciphertext;
  if (!cipherB64?.trim()) {
    throw new DecryptError("CIPHERTEXT_MISSING", "ciphertext maydoni yo'q");
  }

  let sess = await getSession(peerId);
  if (!sess) {
    throw new DecryptError(
      "SESSION_NOT_FOUND",
      `Sessiya yo'q (${peerId}) — key_exchange kuting yoki xabar yuboring`
    );
  }

  let iv: Uint8Array;
  let body: Uint8Array;
  let total: number;
  try {
    ({ iv, body, total } = parseCipherBlob(cipherB64));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.toLowerCase().includes("base64") ? "BASE64_INVALID" : "IV_LENGTH";
    throw new DecryptError(code as "BASE64_INVALID" | "IV_LENGTH", msg, e);
  }
  if (iv.length !== 12) {
    throw new DecryptError("IV_LENGTH", `IV uzunligi noto'g'ri: ${iv.length} (kutilgan 12)`);
  }

  try {
    sess = await advanceRecvChain(sess, header.msg_num);
  } catch (e) {
    if (e instanceof DecryptError) throw e;
    throw new DecryptError("OUT_OF_ORDER", e instanceof Error ? e.message : String(e), e);
  }

  const ck           = fromb64(sess.recvCk);
  const [mk, nextCk] = await kdfCk(ck);

  const ct  = new Uint8Array(12 + body.length);
  ct.set(iv);
  ct.set(body, 12);
  const aad = headerAad(header);

  let pt: Uint8Array;
  try {
    pt = await aesDecrypt(mk, ct, aad);
  } catch (e) {
    console.error("[WebCrypto] ❌ AES-GCM / Invalid MAC:", {
      peerId,
      msg_num:      header.msg_num,
      recvMsgNum:   sess.recvMsgNum,
      session_role: sess.role ?? "unknown",
      ct_len:       total,
      iv_len:       iv.length,
      body_len:     body.length,
      iv_hex:       Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join(""),
      dh_rk:        header.dh_ratchet_pk ? header.dh_ratchet_pk.slice(0, 16) + "…" : "(empty)",
      aad_preview:  new TextDecoder().decode(aad).slice(0, 80),
    });
    throw new DecryptError(
      "AES_GCM_FAILED",
      `Invalid MAC yoki kalit mos emas (peer=${peerId}, msg_num=${header.msg_num})`,
      e
    );
  }

  await saveSession(peerId, {
    ...sess,
    recvCk:     b64(nextCk),
    recvMsgNum: header.msg_num + 1,
  });

  return new TextDecoder().decode(pt);
}
