import type { Message } from "@/types";
import { DECRYPT_ERROR_LABEL } from "@/crypto/adapter";
import { parseMediaPayload } from "@/crypto/fileCrypto";
import { MediaContent } from "./MessageBubble";
import s from "./MediaAlbumBubble.module.css";
import mb from "./MessageBubble.module.css";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function StatusTicks({ status }: { status: Message["status"] }) {
  if (status === "read") return <span className={mb.ticksRead}>✓✓</span>;
  return <span className={mb.ticks}>✓</span>;
}

function gridClass(count: number): string {
  if (count === 2) return s.grid2;
  if (count === 3) return s.grid3;
  if (count === 4) return s.grid4;
  return s.gridMany;
}

function visualType(msg: Message): "image" | "video" | null {
  if (msg.msg_type === "image") return "image";
  if (msg.msg_type === "video") return "video";
  return null;
}

function renderVisualCells(
  messages: Message[],
  onMediaOpen?: (messageId: string) => void,
) {
  const cells = messages.map((message, idx) => {
    const pt = message.plaintext ?? "";
    const isUploading = pt.startsWith("⏳");
    const isError = pt.startsWith("⚠ Yuborilmadi") || pt === DECRYPT_ERROR_LABEL;
    const payload = parseMediaPayload(pt);
    const vType = visualType(message);
    const showOverflow = messages.length > 4 && idx === 3;

    if (isUploading || isError || !payload || !vType) {
      return (
        <div key={message.id} className={s.cell}>
          <div className={s.cellFallback}>{isUploading ? "⏳" : "⚠"}</div>
        </div>
      );
    }

    return (
      <div key={message.id} className={s.cell}>
        <MediaContent
          payload={payload}
          msgType={vType}
          compact
          onMediaClick={
            onMediaOpen ? () => onMediaOpen(message.id) : undefined
          }
        />
        {showOverflow && (
          <button
            type="button"
            className={s.moreOverlay}
            onClick={() => onMediaOpen?.(message.id)}
            aria-label={`Yana ${messages.length - 4} ta media`}
          >
            +{messages.length - 4}
          </button>
        )}
      </div>
    );
  });

  const visible = messages.length > 4 ? cells.slice(0, 4) : cells;

  return (
    <div className={`${s.grid} ${gridClass(Math.min(messages.length, 4))}`}>
      {visible}
    </div>
  );
}

function renderFileList(messages: Message[]) {
  return (
    <div className={s.fileList}>
      {messages.map((message) => {
        const pt = message.plaintext ?? "";
        const isUploading = pt.startsWith("⏳");
        const isError = pt.startsWith("⚠ Yuborilmadi") || pt === DECRYPT_ERROR_LABEL;
        const payload = parseMediaPayload(pt);

        if (isUploading || isError || !payload) {
          return (
            <div key={message.id} className={s.fileRow}>
              <div className={s.fileRowFallback}>{isUploading ? "⏳ Yuklanmoqda…" : "⚠ Xato"}</div>
            </div>
          );
        }

        return (
          <div key={message.id} className={s.fileRow}>
            <MediaContent payload={payload} msgType="file" albumRow />
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  messages:     Message[];
  isOwn:        boolean;
  onImageOpen?: (messageId: string) => void;
}

export default function MediaAlbumBubble({ messages, isOwn, onImageOpen }: Props) {
  const last = messages[messages.length - 1]!;
  const caption = messages
    .map((m) => parseMediaPayload(m.plaintext)?.caption?.trim())
    .find(Boolean) ?? "";

  const visualMsgs = messages.filter((m) => m.msg_type === "image" || m.msg_type === "video");
  const fileMsgs   = messages.filter((m) => m.msg_type === "file");

  return (
    <div className={`${mb.wrap} ${isOwn ? mb.own : mb.incoming}`}>
      <div className={`${mb.bubble} ${isOwn ? mb.bubbleOwn : mb.bubbleIn} ${mb.bubbleMedia}`}>
        {visualMsgs.length > 0 && renderVisualCells(visualMsgs, onImageOpen)}
        {fileMsgs.length > 0 && renderFileList(fileMsgs)}

        {caption && (
          <p className={`${mb.text} ${mb.mediaCaption} selectable`}>{caption}</p>
        )}

        <div className={mb.meta}>
          <span className={mb.time}>{fmtTime(last.created_at)}</span>
          {isOwn && (
            <span className={mb.status}>
              {last.status === "sending" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="9"
                    strokeDasharray="56" strokeDashoffset="14"
                    style={{ animation: "spin 1s linear infinite", transformOrigin: "center" }}/>
                </svg>
              ) : (
                <StatusTicks status={last.status} />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
