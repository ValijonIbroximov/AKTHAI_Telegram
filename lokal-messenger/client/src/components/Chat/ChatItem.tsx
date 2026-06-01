// Suhbat ro'yxatidagi yagona qator.
import type { Chat } from "@/types";
import s from "./ChatItem.module.css";

const COLORS = ["#1a6b8a","#1a6b4a","#6b4a1a","#6b1a4a","#4a1a6b","#1a4a6b"];
function colorFor(str: string) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function fmtTime(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" });
}

interface Props { chat: Chat; active: boolean; onSelect(): void; }

export default function ChatItem({ chat, active, onSelect }: Props) {
  const preview = chat.last_message?.preview ?? "// xabar yo'q";
  const time    = chat.last_message ? fmtTime(chat.last_message.created_at) : "";

  return (
    <div
      className={`${s.root} ${active ? s.active : ""}`}
      onClick={onSelect}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onSelect()}
      aria-selected={active}
    >
      <div
        className={s.avatar}
        style={{ background: colorFor(chat.title) }}
        aria-hidden
      >
        {chat.title.charAt(0).toUpperCase()}
      </div>

      <div className={s.body}>
        <div className={s.top}>
          <span className={s.title}>{chat.title}</span>
          <span className={s.time}>{time}</span>
        </div>
        <div className={s.bot}>
          <span className={s.preview}>{preview}</span>
          {chat.unread_count > 0 && (
            <span className={s.badge}>
              {chat.unread_count > 99 ? "99+" : chat.unread_count}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
