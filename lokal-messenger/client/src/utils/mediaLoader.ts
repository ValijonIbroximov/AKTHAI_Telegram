import { mediaApi } from "@/api/http";
import { decryptFile, fcFromB64, type MediaPayload } from "@/crypto/fileCrypto";

/** Serverdan shifrlangan media yuklab, deshifrlangan Blob qaytaradi. */
export async function loadDecryptedMedia(token: string, payload: MediaPayload): Promise<Blob> {
  const encBlob  = await mediaApi.downloadFile(token, payload.url);
  const keyBytes = fcFromB64(payload.aes_key);
  const ivBytes  = fcFromB64(payload.iv);
  const decBlob  = await decryptFile(encBlob, keyBytes, ivBytes);
  return new Blob([decBlob], { type: payload.mime_type || "application/octet-stream" });
}
