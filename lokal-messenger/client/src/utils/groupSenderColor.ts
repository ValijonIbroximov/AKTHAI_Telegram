export interface GroupSenderBubbleStyle {
  background:  string;
  borderColor: string;
  nameColor:   string;
}

/** Guruh xabarlari uchun aniqroq ajratilgan ranglar */
const GROUP_BUBBLE_COLORS = [
  "#3d7de4", // ko'k
  "#0da678", // yashil
  "#9b59b6", // binafsha
  "#e67e22", // to'q sariq
  "#dc2743", // qizil
  "#0e8174", // firuza
  "#c2a62e", // oltin
  "#7958d4", // indigo
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function colorForUser(userId: string): string {
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return GROUP_BUBBLE_COLORS[Math.abs(hash) % GROUP_BUBBLE_COLORS.length]!;
}

/** Guruh a'zosi uchun barqaror xabar rangi (userId bo'yicha) */
export function groupSenderBubbleStyle(userId: string): GroupSenderBubbleStyle {
  const c1 = colorForUser(userId);
  const [r, g, b] = hexToRgb(c1);
  return {
    background:  `rgba(${r}, ${g}, ${b}, 0.16)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.42)`,
    nameColor:   c1,
  };
}
