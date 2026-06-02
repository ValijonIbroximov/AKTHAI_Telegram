// Umumiy avatar komponenti — Telegram uslubidagi gradient doira.
import { useMemo } from "react";
import s from "./Avatar.module.css";

const GRADIENTS = [
  ["#f09433","#e6683c"],
  ["#dc2743","#cc2366"],
  ["#3d7de4","#2962d9"],
  ["#0e8174","#0da678"],
  ["#7958d4","#5e44a8"],
  ["#c2a62e","#e8c32e"],
];

function gradientFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  const [c1, c2] = GRADIENTS[Math.abs(h) % GRADIENTS.length]!;
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

interface AvatarProps {
  name:    string;
  size?:   number;
  online?: boolean;
  square?: boolean;
}

export default function Avatar({ name, size = 46, online, square = false }: AvatarProps) {
  const bg = useMemo(() => gradientFor(name), [name]);
  const radius = square ? "var(--r-sm)" : "50%";

  return (
    <div
      className={s.root}
      style={{
        width:        size,
        height:       size,
        background:   bg,
        fontSize:     Math.round(size * 0.38),
        borderRadius: radius,
      }}
      aria-label={name}
    >
      {name.charAt(0).toUpperCase()}
      {online !== undefined && (
        <span
          className={s.dot}
          style={{
            background:  online ? "var(--success)" : "transparent",
            borderColor: online ? "var(--bg-panel)" : "var(--text-3)",
          }}
        />
      )}
    </div>
  );
}
