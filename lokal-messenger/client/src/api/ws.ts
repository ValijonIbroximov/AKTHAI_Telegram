// WebSocket ulanishini boshqaruvchi singleton.
// TLS aktiv bo'lgani uchun wss:// protokoli ishlatiladi.
import type { WsEvent } from "@/types";

// Dev rejimida Vite proxy WS ulanishini ham yo'naltiradi (wss → ws).
// Production build'da to'g'ridan-to'g'ri wss:// ishlatiladi.
const WS_URL = import.meta.env.PROD
  ? "wss://server.lokal:8443/ws"
  : "ws://localhost:1420/ws";
const PING_INTERVAL_MS  = 25_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECTS     = 10;

type EventHandler = (event: WsEvent) => void;

class WsClient {
  private socket:       WebSocket | null = null;
  private token:        string = "";
  private handlers:     Set<EventHandler> = new Set();
  private pingTimer:    ReturnType<typeof setInterval> | null = null;
  private reconnects:   number = 0;
  private shouldRun:    boolean = false;

  // Ulangan so'ng token bilan WebSocket ochiladi
  connect(token: string): void {
    this.token    = token;
    this.shouldRun = true;
    this.reconnects = 0;
    this._open();
  }

  disconnect(): void {
    this.shouldRun = false;
    this._cleanup();
  }

  // Har bir xabar yuborish uchun JSON payload jo'natiladi
  send(payload: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  // Hodisa tinglovchisi ro'yxatdan o'tkaziladi
  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private _open(): void {
    const url = `${WS_URL}?token=${encodeURIComponent(this.token)}`;
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.reconnects = 0;
      this._startPing();
    };

    this.socket.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as WsEvent;
        this.handlers.forEach((h) => h(event));
      } catch {
        // Noto'g'ri formatli hodisalar jimlik bilan o'tkazib yuboriladi
      }
    };

    this.socket.onclose = () => {
      this._cleanup();
      if (this.shouldRun && this.reconnects < MAX_RECONNECTS) {
        this.reconnects++;
        setTimeout(() => this._open(), RECONNECT_DELAY_MS * this.reconnects);
      }
    };

    this.socket.onerror = () => this.socket?.close();
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, PING_INTERVAL_MS);
  }

  private _stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private _cleanup(): void {
    this._stopPing();
    if (this.socket) {
      this.socket.onopen    = null;
      this.socket.onmessage = null;
      this.socket.onclose   = null;
      this.socket.onerror   = null;
      if (this.socket.readyState < WebSocket.CLOSING) {
        this.socket.close();
      }
      this.socket = null;
    }
  }
}

// Yagona singleton misoli butun ilova bo'ylab ishlatiladi
export const wsClient = new WsClient();
