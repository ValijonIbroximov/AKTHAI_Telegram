// Mavzu konteksti: data-theme atributi orqali CSS o'zgaruvchilarini boshqaradi.
// Tanlangan mavzu va rejim localStorage'ga yoziladi.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  type ThemeId,
  type ThemeMode,
} from "@/themes";

interface ThemeCtx {
  theme:   ThemeId;
  mode:    ThemeMode;
  setTheme: (t: ThemeId)   => void;
  setMode:  (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({
  theme:    DEFAULT_THEME,
  mode:     DEFAULT_MODE,
  setTheme: () => {},
  setMode:  () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    return (localStorage.getItem("theme") as ThemeId) ?? DEFAULT_THEME;
  });
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem("themeMode") as ThemeMode) ?? DEFAULT_MODE;
  });

  useEffect(() => {
    document.body.setAttribute("data-theme", `${theme}-${mode}`);
    localStorage.setItem("theme",     theme);
    localStorage.setItem("themeMode", mode);
  }, [theme, mode]);

  const setTheme = (t: ThemeId) => setThemeState(t);
  const setMode  = (m: ThemeMode) => setModeState(m);

  return (
    <Ctx.Provider value={{ theme, mode, setTheme, setMode }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
