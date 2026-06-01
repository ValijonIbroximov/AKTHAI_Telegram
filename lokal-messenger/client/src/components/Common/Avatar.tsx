// Foydalanuvchi avatari — Telegram uslubida ranglar bilan bosh harf ko'rsatiladi.
import { useMemo } from "react";
import styles from "./Avatar.module.css";

const COLORS = [
  "#c03d33", "#4fad2d", "#d09306", "#168acd",
  "#8544d6", "#cd4073", "#2996ad", "#ce671b",
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface AvatarProps {
  name:     string;
  size?:    number;
  online?:  boolean;
}

export default function Avatar({ name, size = 42, online }: AvatarProps) {
  const color  = useMemo(() => colorFor(name), [name]);
  const letter = name.charAt(0).toUpperCase();

  return (
    <div
      className={styles.root}
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
      aria-label={name}
    >
      {letter}
      {online !== undefined && (
        <span
          className={styles.dot}
          style={{ background: online ? "var(--green)" : "transparent", border: online ? "none" : "2px solid var(--text-3)" }}
          aria-label={online ? "Online" : "Offline"}
        />
      )}
    </div>
  );
}
