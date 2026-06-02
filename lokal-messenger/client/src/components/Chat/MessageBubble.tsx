// Telegram Desktop uslubidagi xabar pufakchasi.
import type { Message } from "@/types";
import s from "./MessageBubble.module.css";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function TickIcon({ read }: { read: boolean }) {
  return (
    <svg
      width="15" height="11"
      viewBox="0 0 15 11"
      fill="none"
      className={read ? s.tickRead : s.tick}
    >
      <path d="M1 5.5L4.5 9L10 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5.5 9L11 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={read ? 1 : 0}/>
    </svg>
  );
}

interface Props { message: Message; isOwn: boolean; }

export default function MessageBubble({ message, isOwn }: Props) {
  const failed = message.plaintext === null && message.msg_type === "text";

  return (
    <div className={`${s.wrap} ${isOwn ? s.own : s.incoming}`}>
      <div className={`${s.bubble} ${isOwn ? s.bubbleOwn : s.bubbleIn}`}>

        {failed ? (
          <p className={s.textFailed}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            Shifr ochilmadi
          </p>
        ) : (
          <p className={`${s.text} selectable`}>{message.plaintext ?? ""}</p>
        )}

        {/* Vaqt + holat */}
        <div className={s.meta}>
          <span className={s.time}>{fmtTime(message.created_at)}</span>
          {isOwn && (
            <span className={s.status}>
              {message.status === "sending" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="14"
                    style={{ animation: "spin 1s linear infinite", transformOrigin: "center" }}/>
                </svg>
              ) : (
                <TickIcon read={message.status === "read"} />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
