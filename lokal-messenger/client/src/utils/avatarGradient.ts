/** Avatar gradientlari — Avatar va bildirishnomalar uchun umumiy */
export const AVATAR_GRADIENTS = [
  ["#f09433", "#e6683c"],
  ["#dc2743", "#cc2366"],
  ["#3d7de4", "#2962d9"],
  ["#0e8174", "#0da678"],
  ["#7958d4", "#5e44a8"],
  ["#c2a62e", "#e8c32e"],
] as const;

export function gradientPairFor(name: string): readonly [string, string] {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length]!;
}

export function gradientCssFor(name: string): string {
  const [c1, c2] = gradientPairFor(name);
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

const iconCache = new Map<string, string>();

/** OS bildirishnoma iconi — ism bosh harfi bilan gradient doira */
export function avatarIconUrl(name: string, size = 96): string {
  const key = `${name}:${size}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const [c1, c2] = gradientPairFor(name || "?");
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const r = size / 2;
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();

  const letter = (name?.trim() || "?").charAt(0).toUpperCase();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `600 ${Math.round(size * 0.42)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, r, r + size * 0.02);

  const url = canvas.toDataURL("image/png");
  iconCache.set(key, url);
  return url;
}
