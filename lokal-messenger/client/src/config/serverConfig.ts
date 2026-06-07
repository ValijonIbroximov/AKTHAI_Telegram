// Eski API — devServer.ts ga yo'naltiriladi.
import {
  getApiBaseUrl,
  buildWsUrl,
  setDevServerHost,
  resolveDevServerHost,
  hasDevServerHost,
} from "./devServer";

export function getServerUrl(): string {
  const host = resolveDevServerHost();
  if (host === "127.0.0.1" || host === "localhost") return "";
  return `https://${host}:8443`;
}

export function setServerUrl(url: string): void {
  const h = url.replace(/\/+$/, "");
  try {
    const u = new URL(h.startsWith("http") ? h : `https://${h}`);
    setDevServerHost(u.hostname, u.port || "8443");
  } catch {
    setDevServerHost(h.replace(/^https?:\/\//, "").split(":")[0] ?? h);
  }
}

export function hasServerUrl(): boolean {
  return hasDevServerHost();
}

export function getApiBase(): string {
  return getApiBaseUrl();
}

export function getWsUrl(): string {
  return buildWsUrl("");
}
