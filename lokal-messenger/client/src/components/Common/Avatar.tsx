// Umumiy avatar komponenti — Telegram uslubidagi gradient doira.
import { useMemo } from "react";
import { gradientCssFor } from "@/utils/avatarGradient";
import s from "./Avatar.module.css";

interface AvatarProps {
  name:    string;
  size?:   number;
  online?: boolean;
  square?: boolean;
}

export default function Avatar({ name, size = 46, online, square = false }: AvatarProps) {
  const bg = useMemo(() => gradientCssFor(name), [name]);
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
