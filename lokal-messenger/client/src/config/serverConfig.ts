// Eski API — devServer.ts ga yo'naltiriladi.
import { getApiBaseUrl, buildWsUrl, resolveDevServerHost } from "./devServer";

export function getServerUrl(): string {
  return `https://${resolveDevServerHost()}:8443`;
}

/** Host brauzer hostname dan olinadi; qo'lda o'zgartirish kerak emas */
export function setServerUrl(_url: string): void {}

export function hasServerUrl(): boolean {
  return true;
}

export function getApiBase(): string {
  return getApiBaseUrl();
}

export function getWsUrl(): string {
  return buildWsUrl("");
}
