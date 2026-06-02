// Kengaytirilgan Theme Engine:
// - Mavzu (5 ta uslub × 2 ta rejim)
// - Qo'lda sozlash: asosiy rang, shrift, burchak shakli
// - Barcha o'zgarishlar real-time CSS Variables orqali ishlaydi
// - Minimal render: faqat kerak bo'lganda qayta chiziladi

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  type ThemeId,
  type ThemeMode,
} from "@/themes";

/* ── Qo'lda sozlash turlari ── */
export type RadiusPreset = "sharp" | "medium" | "soft";
export type FontChoice   = "inter" | "roboto" | "mono" | "segoe";

export interface ThemeCustom {
  color:  string | null;       // Hex rang, null = mavzu standart
  font:   FontChoice | null;   // Shrift, null = mavzu standart
  radius: RadiusPreset | null; // Burchak shakli, null = mavzu standart
}

/* ── Radius preset qiymatlari ── */
const RADIUS_MAP: Record<RadiusPreset, Record<string, string>> = {
  sharp:  { "--r-xs": "0px",  "--r-sm": "0px",  "--r-md": "2px",  "--r-lg": "2px",  "--r-xl": "4px",    "--r-full": "2px"    },
  medium: { "--r-xs": "4px",  "--r-sm": "8px",  "--r-md": "12px", "--r-lg": "16px", "--r-xl": "20px",   "--r-full": "9999px" },
  soft:   { "--r-xs": "10px", "--r-sm": "16px", "--r-md": "20px", "--r-lg": "24px", "--r-xl": "32px",   "--r-full": "9999px" },
};

/* ── Shrift steklari ── */
const FONT_STACKS: Record<FontChoice, string> = {
  inter:  "'Inter', -apple-system, 'Roboto', 'Segoe UI', sans-serif",
  roboto: "'Roboto', 'Segoe UI', 'Helvetica Neue', sans-serif",
  mono:   "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  segoe:  "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
};

/* ── Asosiy rang o'zgarganda kerakli boshqa ranglar ── */
function deriveAccentVars(hex: string): Record<string, string> {
  // Oddiy alfa-variant hisoblash (CSS Custom Properties bilan ishlash uchun)
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    "--accent":      hex,
    "--accent-dim":  `rgb(${Math.round(r * 0.75)},${Math.round(g * 0.75)},${Math.round(b * 0.75)})`,
    "--accent-dark": `rgb(${Math.round(r * 0.25)},${Math.round(g * 0.25)},${Math.round(b * 0.25)})`,
    "--accent-glow": `rgba(${r},${g},${b},0.28)`,
    "--accent-xs":   `rgba(${r},${g},${b},0.09)`,
    "--cyan": hex, "--cyan-dim": `rgb(${Math.round(r*0.75)},${Math.round(g*0.75)},${Math.round(b*0.75)})`,
    "--cyan-dark": `rgb(${Math.round(r*0.25)},${Math.round(g*0.25)},${Math.round(b*0.25)})`,
    "--cyan-glow": `rgba(${r},${g},${b},0.28)`,
    "--cyan-glow-s": `rgba(${r},${g},${b},0.09)`,
  };
}

/* ── localStorage kalitlari ── */
const LS = {
  theme:       "tm_theme",
  mode:        "tm_mode",
  customColor: "tm_custom_color",
  customFont:  "tm_custom_font",
  customRadius:"tm_custom_radius",
} as const;

/* ── Kontekst interfeysi ── */
interface ThemeCtx {
  theme:   ThemeId;
  mode:    ThemeMode;
  custom:  ThemeCustom;
  setTheme:  (t: ThemeId)            => void;
  setMode:   (m: ThemeMode)          => void;
  setCustomColor:  (c: string | null) => void;
  setCustomFont:   (f: FontChoice | null) => void;
  setCustomRadius: (r: RadiusPreset | null) => void;
  resetCustom: () => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: DEFAULT_THEME,
  mode:  DEFAULT_MODE,
  custom: { color: null, font: null, radius: null },
  setTheme:        () => {},
  setMode:         () => {},
  setCustomColor:  () => {},
  setCustomFont:   () => {},
  setCustomRadius: () => {},
  resetCustom:     () => {},
});

/* ── CSS o'zgaruvchisini document.documentElement ga qo'llash ── */
function applyCssVar(key: string, value: string) {
  document.documentElement.style.setProperty(key, value);
}
function removeCssVar(key: string) {
  document.documentElement.style.removeProperty(key);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(
    () => (localStorage.getItem(LS.theme) as ThemeId) ?? DEFAULT_THEME
  );
  const [mode, setModeState] = useState<ThemeMode>(
    () => (localStorage.getItem(LS.mode) as ThemeMode) ?? DEFAULT_MODE
  );
  const [custom, setCustomState] = useState<ThemeCustom>(() => ({
    color:  localStorage.getItem(LS.customColor)  || null,
    font:   (localStorage.getItem(LS.customFont)  as FontChoice) || null,
    radius: (localStorage.getItem(LS.customRadius) as RadiusPreset) || null,
  }));

  // data-theme atributini body ga qo'llash (faqat theme/mode o'zgarganda)
  useEffect(() => {
    document.body.setAttribute("data-theme", `${theme}-${mode}`);
    localStorage.setItem(LS.theme, theme);
    localStorage.setItem(LS.mode,  mode);
  }, [theme, mode]);

  // Qo'lda rang — real-time CSS var
  const prevColorRef = useRef<string | null>(null);
  useEffect(() => {
    if (custom.color) {
      try {
        const vars = deriveAccentVars(custom.color);
        Object.entries(vars).forEach(([k, v]) => applyCssVar(k, v));
        localStorage.setItem(LS.customColor, custom.color);
      } catch { /* noto'g'ri hex */ }
    } else {
      if (prevColorRef.current) {
        // Standartga qaytarish
        const vars = deriveAccentVars("#000000"); // placeholder
        Object.keys(vars).forEach(removeCssVar);
        localStorage.removeItem(LS.customColor);
      }
    }
    prevColorRef.current = custom.color;
  }, [custom.color]);

  // Qo'lda shrift — real-time CSS var
  useEffect(() => {
    if (custom.font) {
      applyCssVar("--font-ui", FONT_STACKS[custom.font]);
      localStorage.setItem(LS.customFont, custom.font);
    } else {
      removeCssVar("--font-ui");
      localStorage.removeItem(LS.customFont);
    }
  }, [custom.font]);

  // Qo'lda radius — real-time CSS var
  useEffect(() => {
    if (custom.radius) {
      const vars = RADIUS_MAP[custom.radius];
      Object.entries(vars).forEach(([k, v]) => applyCssVar(k, v));
      localStorage.setItem(LS.customRadius, custom.radius);
    } else {
      Object.keys(RADIUS_MAP.sharp).forEach(removeCssVar);
      localStorage.removeItem(LS.customRadius);
    }
  }, [custom.radius]);

  // Setter funksiyalar — useCallback bilan re-render oldini olish
  const setTheme = useCallback((t: ThemeId) => setThemeState(t), []);
  const setMode  = useCallback((m: ThemeMode) => setModeState(m), []);

  const setCustomColor = useCallback((c: string | null) =>
    setCustomState(prev => ({ ...prev, color: c })), []);

  const setCustomFont = useCallback((f: FontChoice | null) =>
    setCustomState(prev => ({ ...prev, font: f })), []);

  const setCustomRadius = useCallback((r: RadiusPreset | null) =>
    setCustomState(prev => ({ ...prev, radius: r })), []);

  const resetCustom = useCallback(() => {
    setCustomState({ color: null, font: null, radius: null });
  }, []);

  const value = useMemo(
    () => ({ theme, mode, custom, setTheme, setMode, setCustomColor, setCustomFont, setCustomRadius, resetCustom }),
    [theme, mode, custom, setTheme, setMode, setCustomColor, setCustomFont, setCustomRadius, resetCustom]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/* Eksport qo'shimcha utility lar */
export { FONT_STACKS, RADIUS_MAP };
export const FONT_LABELS: Record<FontChoice, string> = {
  inter:  "Inter (zamonaviy)",
  roboto: "Roboto (Android)",
  mono:   "Monospace (kodni)",
  segoe:  "Segoe UI (Windows)",
};
export const RADIUS_LABELS: Record<RadiusPreset, string> = {
  sharp:  "Keskin (0px)",
  medium: "O'rtacha (8px)",
  soft:   "Yumshoq (16px)",
};
