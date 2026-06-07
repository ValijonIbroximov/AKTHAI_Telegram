// API/WS manzillari.
// Dev (Vite :1420): so'rovlar /api va /ws orqali proxy — brauzer TLS xatosiz.
// Prod: sahifa hosti bo'yicha to'g'ridan :8443 ga.

const API_PORT = 8443;

const LEGACY_LS_KEY = "harbiy-server-url";
const LEGACY_SS_KEY = "dev_server_host";

function pageHost(): string {
  if (typeof window === "undefined") return "127.0.0.1";
  return window.location.hostname || "127.0.0.1";
}

/** Vite dev server proxy orqali backendga ulanish */
function useViteProxy(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined";
}

if (typeof window !== "undefined") {
  try {
    localStorage.removeItem(LEGACY_LS_KEY);
    sessionStorage.removeItem(LEGACY_SS_KEY);
  } catch { /* storage bloklangan */ }
}

/** Joriy sahifa hosti (API ham shu manzilga ulanadi) */
export function resolveDevServerHost(): string {
  return pageHost();
}

export function getApiBaseUrl(): string {
  if (useViteProxy()) {
    return "/api/v1";
  }
  return `https://${pageHost()}:${API_PORT}/api/v1`;
}

export function buildWsUrl(token: string): string {
  const q = `?token=${encodeURIComponent(token)}`;
  if (useViteProxy()) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws${q}`;
  }
  return `wss://${pageHost()}:${API_PORT}/ws${q}`;
}

export async function probeDevServer(): Promise<boolean> {
  try {
    const url = useViteProxy()
      ? "/healthz"
      : `https://${pageHost()}:${API_PORT}/healthz`;
    const r = await fetch(url, {
      method: "GET",
      ...(useViteProxy() ? {} : { mode: "cors" as RequestMode }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
