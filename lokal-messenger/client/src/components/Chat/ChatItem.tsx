// Suhbat ro'yxatidagi element — Telegram Desktop uslubi.
// Doira avatar, ism, preview, vaqt va o'qilmagan xabarlar badge'i.
import type { Chat } from "@/types";
import s from "./ChatItem.module.css";

// Telegram Desktop avatarlari uchun gradient rang palitasi
const AVATAR_GRADIENTS = [
  ["#f09433","#e6683c"],
  ["#dc2743","#cc2366"],
  ["#e14a55","#d44d2a"],
  ["#3d7de4","#2962d9"],
  ["#0e8174","#0da678"],
  ["#7958d4","#5e44a8"],
  ["#c2a62e","#e8c32e"],
];

function gradientFor(str: string): [string, string] {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  const pair = AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]!;
  return [pair[0], pair[1]];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 7)
    return d.toLocaleDateString("uz-UZ", { weekday: "short" });
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" });
}

interface Props { chat: Chat; active: boolean; onSelect(): void; }

export default function ChatItem({ chat, active, onSelect }: Props) {
  const preview  = chat.last_message?.preview ?? "";
  const time     = chat.last_message ? fmtTime(chat.last_message.created_at) : "";
  const [c1, c2] = gradientFor(chat.title);

  return (
    <div
      className={`${s.root} ${active ? s.active : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onSelect()}
      aria-selected={active}
    >
      {/* Doira avatar */}
      <div
        className={s.avatar}
        style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)` }}
        aria-hidden="true"
      >
        {chat.title.charAt(0).toUpperCase()}
      </div>

      {/* Kontent */}
      <div className={s.body}>
        <div className={s.top}>
          <span className={s.title}>{chat.title}</span>
          <span className={s.time}>{time}</span>
        </div>
        <div className={s.bottom}>
          <span className={s.preview}>{preview || "\u00A0"}</span>
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
