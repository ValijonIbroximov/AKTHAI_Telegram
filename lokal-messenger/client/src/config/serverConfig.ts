const KEY = "harbiy-server-url";

export function getServerUrl(): string {
  return localStorage.getItem(KEY) ?? "";
}

export function setServerUrl(url: string): void {
  localStorage.setItem(KEY, url.replace(/\/+$/, ""));
}

export function hasServerUrl(): boolean {
  return !!localStorage.getItem(KEY);
}

export function getApiBase(): string {
  const url = getServerUrl();
  return url ? `${url}/api/v1` : "/api/v1";
}

export function getWsUrl(): string {
  const url = getServerUrl();
  if (!url) return "ws://localhost:1420/ws";
  return url.replace(/^https/, "wss").replace(/^http/, "ws") + "/ws";
}
