// Profil surati yoki gradient fallback avatar.
import { useState } from "react";
import { buildAvatarUrl } from "@/api/http";
import { gradientCssFor } from "@/utils/avatarGradient";
import s from "./UserAvatar.module.css";

interface Props {
  userId:      string;
  name:        string;
  token?:      string | null;
  hasAvatar?:  boolean;
  size?:       number;
  className?:  string;
  cacheKey?:   string;
}

export default function UserAvatar({
  userId, name, token, hasAvatar = false, size = 40, className = "", cacheKey = "",
}: Props) {
  const [imgErr, setImgErr] = useState(false);
  const initial = (name.trim() || "?").charAt(0).toUpperCase();
  const showImg = hasAvatar && token && !imgErr;

  return (
    <div
      className={`${s.wrap} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {showImg ? (
        <img
          className={s.img}
          src={buildAvatarUrl(userId, token, cacheKey)}
          alt=""
          onError={() => setImgErr(true)}
        />
      ) : (
        <div className={s.fallback} style={{ background: gradientCssFor(name) }}>
          {initial}
        </div>
      )}
    </div>
  );
}
