// Dev/LAN: Go server manzili (Vite proxy va to'g'ridan-to'g'ri ulanish).
//
// .19 mashinada npm run dev + server .32 da:
//   .env.development.local → VITE_API_HOST=192.168.101.32
// yoki login ekranida server IP ni kiriting.

const LS_SERVER_URL = "harbiy-server-url";
const SS_SERVER_HOST = "dev_server_host";

function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Saqlangan server IP/host (masalan 192.168.101.32) */
export function resolveDevServerHost(): string {
  if (typeof window !== "undefined") {
    const ss = sessionStorage.getItem(SS_SERVER_HOST)?.trim();
    if (ss) return ss;

    const lsUrl = localStorage.getItem(LS_SERVER_URL)?.trim();
    if (lsUrl) {
      const h = hostFromUrl(lsUrl);
      if (h) return h;
    }

    // Dev: brauzer qaysi host orqali ochilgan bo'lsa (masalan 192.168.101.32:1420),
    // Go server ham shu IP da — localhost proxy emas.
    if (import.meta.env.DEV) {
      const pageHost = window.location.hostname;
      if (!isLocalHost(pageHost)) return pageHost;
    }
  }

  const env = import.meta.env.VITE_API_HOST as string | undefined;
  if (env?.trim()) return env.trim();

  return "127.0.0.1";
}

/** Login / sozlamalarda server IP ni saqlash */
export function setDevServerHost(host: string, port = "8443"): void {
  const trimmed = host.trim();
  if (!trimmed) return;
  const proto = "https";
  const url = `${proto}://${trimmed}:${port}`;
  localStorage.setItem(LS_SERVER_URL, url);
  sessionStorage.setItem(SS_SERVER_HOST, trimmed);
}

export function clearDevServerHost(): void {
  localStorage.removeItem(LS_SERVER_URL);
  sessionStorage.removeItem(SS_SERVER_HOST);
}

export function hasDevServerHost(): boolean {
  const h = resolveDevServerHost();
  return !isLocalHost(h);
}

/** Vite proxy ishlatiladimi (server shu mashinada) */
export function usesViteProxy(): boolean {
  return (import.meta.env.DEV || window.location.port === "8443") &&
    isLocalHost(resolveDevServerHost());
}

export function getApiBaseUrl(): string {
  if (import.meta.env.DEV || window.location.port === "8443") {
    const host = resolveDevServerHost();
    if (isLocalHost(host)) return "/api/v1";
    return `https://${host}:8443/api/v1`;
  }
  return `https://${window.location.hostname}:8443/api/v1`;
}

export function buildWsUrl(token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV || window.location.port === "8443") {
    const host = resolveDevServerHost();
    if (isLocalHost(host)) {
      return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    }
    return `wss://${host}:8443/ws?token=${encodeURIComponent(token)}`;
  }
  return `wss://${window.location.hostname}:8443/ws?token=${encodeURIComponent(token)}`;
}

/** LAN dev: serverga ulanishni tekshirish (login oldidan) */
export async function probeDevServer(host?: string): Promise<boolean> {
  const h = (host?.trim() || resolveDevServerHost()).trim();
  if (!h || isLocalHost(h)) {
    try {
      const r = await fetch("/healthz", { method: "GET" });
      return r.ok;
    } catch {
      return false;
    }
  }
  try {
    const r = await fetch(`https://${h}:8443/healthz`, { method: "GET", mode: "cors" });
    return r.ok;
  } catch {
    return false;
  }
}
