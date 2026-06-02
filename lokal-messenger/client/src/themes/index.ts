// Ilova mavzulari: 5 ta vizual uslub × 2 ta yorug'lik rejimi.
// Har bir mavzu CSS o'zgaruvchilarini qayta belgilaydi (data-theme atributi orqali).

export type ThemeId = "hightech" | "telegram" | "gradient" | "simpletext" | "windows";
export type ThemeMode = "dark" | "light";

export interface ThemeDef {
  id:    ThemeId;
  label: string;
  /** Ikki swatch rangi — mavzu kartochkasini vizuallash uchun */
  preview: [bg: string, accent: string];
}

export const THEMES: ThemeDef[] = [
  { id: "hightech",  label: "High-Tech",       preview: ["#070c18", "#00d4ff"] },
  { id: "telegram",  label: "Telegram",         preview: ["#17212b", "#2aabee"] },
  { id: "gradient",  label: "Gradient",         preview: ["#0d0918", "#a78bfa"] },
  { id: "simpletext",label: "Terminal",         preview: ["#000000", "#00ff41"] },
  { id: "windows",   label: "Windows 11",       preview: ["#202020", "#0078d4"] },
];

export const DEFAULT_THEME: ThemeId = "hightech";
export const DEFAULT_MODE:  ThemeMode = "dark";
