// E2EE fayl va rasm shifrlash/deshifrlash qatlami.
//
// Har bir fayl tasodifiy AES-256-GCM kaliti va IV bilan shifrlanadi.
// Shifrlangan blob Go serverga yuklanadi; server faylning nimaligini bilmaydi.
// Kalit va IV Signal Protocol orqali xabar tanasida jo'natiladi.
//
// Tauri va brauzerda bir xil ishlaydi (Web Crypto API ishlatiladi).

/** Media xabar tanasida Signal orqali jo'natiladigan metadata */
export interface MediaPayload {
  url:       string;  // Server URL: /api/v1/files/{id}
  aes_key:   string;  // Base64 AES-256 kaliti (32 bayt)
  iv:        string;  // Base64 GCM nonce (12 bayt)
  file_name: string;
  mime_type: string;
  size:      number;  // Asl (deshifrlangan) bayt hajmi
  caption?:  string;  // Ixtiyoriy izoh (matn)
  spoiler?:  boolean; // Spoiler (blur) rejimi
  /** Bir vaqtda yuborilgan media guruhi */
  album_id?:    string;
  album_index?: number;
  album_count?: number;
}

// ── Base64 yordamchilari ───────────────────────────────────────────────────

export function fcToB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(out);
}

export function fcFromB64(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const pad  = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

// ── Shifrlash ─────────────────────────────────────────────────────────────

/** Faylni AES-256-GCM bilan shifrlaydi. Tasodifiy kalit va IV yaratiladi. */
export async function encryptFile(file: File): Promise<{
  blob:     Blob;
  key:      Uint8Array;
  iv:       Uint8Array;
  mimeType: string;
  fileName: string;
  size:     number;
}> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv  = crypto.getRandomValues(new Uint8Array(12));

  // Yangi ArrayBuffer'ga ko'chirish (SharedArrayBuffer emas — Web Crypto talab qiladi)
  const keyBuf = new Uint8Array(key).buffer as ArrayBuffer;
  const ivBuf  = new Uint8Array(iv).buffer  as ArrayBuffer;

  const aesKey = await crypto.subtle.importKey(
    "raw", keyBuf, "AES-GCM", false, ["encrypt"],
  );

  const plain     = await file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    aesKey,
    plain,
  );

  return {
    blob:     new Blob([encrypted], { type: "application/octet-stream" }),
    key,
    iv,
    mimeType: file.type || "application/octet-stream",
    fileName: file.name,
    size:     file.size,
  };
}

// ── Deshifrlash ───────────────────────────────────────────────────────────

/**
 * Shifrlangan faylni deshifrlaydi.
 * `key`  — 32 baytli AES-256 kaliti (Uint8Array yoki raw ArrayBuffer)
 * `iv`   — 12 baytli GCM nonce
 */
export async function decryptFile(
  encryptedBlob: Blob,
  key:           Uint8Array,
  iv:            Uint8Array,
): Promise<Blob> {
  const keyBuf = new Uint8Array(key).buffer as ArrayBuffer;
  const ivBuf  = new Uint8Array(iv).buffer  as ArrayBuffer;

  const aesKey = await crypto.subtle.importKey(
    "raw", keyBuf, "AES-GCM", false, ["decrypt"],
  );

  const enc   = await encryptedBlob.arrayBuffer();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuf },
    aesKey,
    enc,
  );

  return new Blob([plain]);
}

// ── Payload yordamchilari ─────────────────────────────────────────────────

/**
 * Xabarning ochiq matni MediaPayload ekanligini tekshiradi.
 * Shunday bo'lsa — parse qilingan obyektni qaytaradi, aks holda null.
 */
export function parseMediaPayload(plaintext: string | null | undefined): MediaPayload | null {
  if (!plaintext) return null;
  const t = plaintext.trimStart();
  if (!t.startsWith("{")) return null;
  try {
    const p = JSON.parse(t) as Record<string, unknown>;
    if (
      typeof p.url       === "string" &&
      typeof p.aes_key   === "string" &&
      typeof p.iv        === "string" &&
      typeof p.file_name === "string" &&
      typeof p.mime_type === "string"
    ) {
      return p as unknown as MediaPayload;
    }
  } catch { /* not JSON */ }
  return null;
}

/** Fayl hajmini inson o'qiy oladigan formatga o'giradi */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024)             return `${bytes} B`;
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Fayl kengaytmasi yoki MIME asosida qisqa tur yorlig'i */
export function fileTypeLabel(payload: Pick<MediaPayload, "file_name" | "mime_type">): string {
  const dot = payload.file_name.lastIndexOf(".");
  if (dot > 0 && dot < payload.file_name.length - 1) {
    const ext = payload.file_name.slice(dot + 1).toUpperCase();
    if (ext.length <= 8) return ext;
  }
  const mime = payload.mime_type.toLowerCase();
  const known: Record<string, string> = {
    "application/pdf":        "PDF",
    "application/msword":     "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/zip":        "ZIP",
    "text/plain":             "TXT",
  };
  if (known[mime]) return known[mime];
  const sub = mime.split("/")[1];
  if (sub) return sub.split("+")[0]!.split(".").pop()!.toUpperCase();
  return "FILE";
}

export type MediaKind = "image" | "video" | "file";

/** MIME yoki "hujjat sifatida" flag asosida xabar media turi */
export function mediaKindFromMime(mime: string, asDocument = false): MediaKind {
  if (asDocument) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

export function isVisualMediaKind(kind: MediaKind): boolean {
  return kind === "image" || kind === "video";
}
