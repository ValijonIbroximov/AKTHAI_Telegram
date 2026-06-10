import type { Message } from "@/types";
import { parseMediaPayload } from "@/crypto/fileCrypto";
import { isSessionSyncPlaintext } from "@/utils/messageText";

export type MessageSegment =
  | { kind: "single"; message: Message }
  | { kind: "album";  messages: Message[] };

function albumMeta(msg: Message) {
  const p = parseMediaPayload(msg.plaintext);
  if (!p?.album_id || !p.album_count || p.album_count <= 1) return null;
  return {
    id:    p.album_id,
    index: p.album_index ?? 0,
    count: p.album_count,
  };
}

/** Ketma-ket kelgan album xabarlarini bitta segmentga birlashtiradi */
export function segmentMessages(msgs: Message[]): MessageSegment[] {
  const visible = msgs.filter((m) => !isSessionSyncPlaintext(m.plaintext));
  const out: MessageSegment[] = [];
  let i = 0;

  while (i < visible.length) {
    const msg = visible[i]!;
    const meta = albumMeta(msg);

    if (!meta) {
      out.push({ kind: "single", message: msg });
      i += 1;
      continue;
    }

    const group: Message[] = [msg];
    let j = i + 1;
    while (j < visible.length) {
      const next = visible[j]!;
      const nm = albumMeta(next);
      if (
        nm &&
        nm.id === meta.id &&
        next.sender_id === msg.sender_id
      ) {
        group.push(next);
        j += 1;
      } else {
        break;
      }
    }

    group.sort((a, b) => {
      const ia = parseMediaPayload(a.plaintext)?.album_index ?? 0;
      const ib = parseMediaPayload(b.plaintext)?.album_index ?? 0;
      return ia - ib;
    });

    out.push({ kind: "album", messages: group });
    i = j;
  }

  return out;
}

export function albumPreviewText(count: number, caption?: string): string {
  const cap = caption?.trim();
  if (cap) return cap.length > 80 ? cap.slice(0, 77) + "…" : cap;
  return `🖼 ${count} ta media`;
}
