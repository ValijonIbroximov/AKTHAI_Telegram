// Yagona xabar pufakchasi.
import type { Message } from "@/types";
import s from "./MessageBubble.module.css";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function Status({ status }: { status: Message["status"] }) {
  if (status === "sending")   return <span className={s.stSending} title="Yuborilmoqda">···</span>;
  if (status === "sent")      return <span className={s.stSent}     title="Yuborildi">✓</span>;
  if (status === "delivered") return <span className={s.stDelivery} title="Yetkazildi">✓✓</span>;
  if (status === "read")      return <span className={s.stRead}     title="O'qildi">✓✓</span>;
  return null;
}

interface Props { message: Message; isOwn: boolean; }

export default function MessageBubble({ message, isOwn }: Props) {
  const failed = message.plaintext === null && message.msg_type === "text";

  return (
    <div className={`${s.wrap} ${isOwn ? s.own : s.incoming}`}>
      <div className={`${s.bubble} ${isOwn ? s.bubbleOwn : s.bubbleIn}`}>

        {failed ? (
          <p className={s.textEncrypted}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            [shifr ochilmadi]
          </p>
        ) : (
          <p className={`${s.text} selectable`}>{message.plaintext ?? ""}</p>
        )}

        <div className={s.meta}>
          <span className={s.time}>{fmtTime(message.created_at)}</span>
          {isOwn && <Status status={message.status} />}
        </div>
      </div>
    </div>
  );
}
