// API/WS manzillari — brauzer qaysi host orqali ochilgan bo'lsa (masalan 192.168.101.32),
// Go backend ham shu host ning 8443 portida deb hisoblanadi.

const API_PORT = 8443;

const LEGACY_LS_KEY = "harbiy-server-url";
const LEGACY_SS_KEY = "dev_server_host";

function pageHost(): string {
  if (typeof window === "undefined") return "127.0.0.1";
  return window.location.hostname || "127.0.0.1";
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
  return `https://${pageHost()}:${API_PORT}/api/v1`;
}

export function buildWsUrl(token: string): string {
  return `wss://${pageHost()}:${API_PORT}/ws?token=${encodeURIComponent(token)}`;
}

export async function probeDevServer(): Promise<boolean> {
  try {
    const r = await fetch(`https://${pageHost()}:${API_PORT}/healthz`, {
      method: "GET",
      mode:   "cors",
    });
    return r.ok;
  } catch {
    return false;
  }
}
