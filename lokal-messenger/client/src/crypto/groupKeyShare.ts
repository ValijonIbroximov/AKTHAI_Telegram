// Guruh AES kalitini a'zolarga Signal orqali ulashish.
import { encryptFirstMessage, decryptMessage } from "@/crypto/adapter";
import { keysApi } from "@/api/http";
import {
  exportChatKeyB64,
  importChatKeyB64,
} from "@/crypto/channelCrypto";

export interface KeyEnvelope {
  user_id:    string;
  ciphertext: string;
}

function groupKeyPayload(chatId: string, keyB64: string): string {
  return JSON.stringify({ t: "group_key", chat_id: chatId, key: keyB64 });
}

/** Tanlangan a'zolar uchun shifrlangan guruh kalit konvertlari */
export async function buildGroupKeyEnvelopes(
  userId:    string,
  chatId:    string,
  memberIds: string[],
  token:     string,
): Promise<KeyEnvelope[]> {
  const keyB64 = exportChatKeyB64(userId, chatId);
  if (!keyB64) {
    throw new Error("Guruh kaliti bu qurilmada topilmadi — guruh yaratilgan qurilmadan ulashing");
  }

  const payload = groupKeyPayload(chatId, keyB64);
  const out: KeyEnvelope[] = [];

  for (const mid of memberIds) {
    if (!mid || mid === userId) continue;
    const bundle = await keysApi.getBundle(token, mid);
    const ciphertext = await encryptFirstMessage(
      chatId, mid, JSON.stringify(bundle), payload,
    );
    out.push({ user_id: mid, ciphertext });
  }
  return out;
}

/** Serverdan olingan konvert orqali mahalliy guruh kalitini o'rnatish */
export async function installGroupKeyFromEnvelope(
  userId:      string,
  chatId:      string,
  fromUserId:  string,
  ciphertext:  string,
): Promise<boolean> {
  try {
    const pt = await decryptMessage(chatId, fromUserId, ciphertext);
    const parsed = JSON.parse(pt) as { t?: string; chat_id?: string; key?: string };
    if (parsed.t !== "group_key" || parsed.chat_id !== chatId || !parsed.key) {
      return false;
    }
    importChatKeyB64(userId, chatId, parsed.key);
    return true;
  } catch {
    return false;
  }
}
