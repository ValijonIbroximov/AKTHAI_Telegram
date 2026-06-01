// Harbiy uslub avatari — to'rtburchak, rang + harf.
import { useMemo } from "react";
import s from "./Avatar.module.css";

const COLORS = ["#1a6b8a","#1a6b4a","#6b4a1a","#6b1a4a","#4a1a6b","#1a4a6b","#6b6b1a"];
function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

interface AvatarProps { name: string; size?: number; online?: boolean; }

export default function Avatar({ name, size = 38, online }: AvatarProps) {
  const bg = useMemo(() => colorFor(name), [name]);
  return (
    <div
      className={s.root}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
      aria-label={name}
    >
      {name.charAt(0).toUpperCase()}
      {online !== undefined && (
        <span
          className={s.dot}
          style={{ background: online ? "var(--success)" : "transparent",
                   borderColor: online ? "var(--bg-panel)" : "var(--text-3)" }}
        />
      )}
    </div>
  );
}
