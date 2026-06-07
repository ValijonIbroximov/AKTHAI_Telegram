import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type BackHandler = () => boolean;

interface Entry {
  priority: number;
  handler: BackHandler;
}

interface BackNavCtx {
  register: (handler: BackHandler, priority?: number) => () => void;
}

const Ctx = createContext<BackNavCtx | null>(null);

/** Katta raqam = Escape da birinchi tekshiriladi */
export const BACK_PRIORITY = {
  imageViewer: 100,
  sideDrawer: 80,
  settings: 60,
  chat: 50,
} as const;

export function BackNavigationProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Entry[]>([]);

  const register = useCallback((handler: BackHandler, priority = 0) => {
    const entry: Entry = { priority, handler };
    handlersRef.current.push(entry);
    return () => {
      handlersRef.current = handlersRef.current.filter((e) => e !== entry);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const list = [...handlersRef.current].sort((a, b) => b.priority - a.priority);
      for (const { handler } of list) {
        if (handler()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const value = useMemo(() => ({ register }), [register]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Escape = orqaga; true qaytarsa keyingi handler ishlamaydi */
export function useRegisterBackHandler(
  handler: BackHandler,
  enabled = true,
  priority = 0,
) {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (!ctx || !enabled) return;
    return ctx.register(handler, priority);
  }, [ctx, enabled, handler, priority]);
}
