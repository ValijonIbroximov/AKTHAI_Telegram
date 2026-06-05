// WebSocket ulanishini boshqaruvchi singleton.
// Multi-account: har switch da eski ulanish to'liq yopiladi, yangi JWT bilan qayta ulanadi.
import type { WsEvent } from "@/types";
import { getWsUrl } from "@/config/serverConfig";

function getWsEndpoint(): string {
  if (import.meta.env.PROD) return getWsUrl();
  return "ws://localhost:1420/ws";
}
const PING_INTERVAL_MS   = 25_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECTS     = 10;
const DISCONNECT_TIMEOUT = 2_000;

type EventHandler = (event: WsEvent) => void;

class WsClient {
  private socket:     WebSocket | null = null;
  private token:      string = "";
  private handlers:   Set<EventHandler> = new Set();
  private pingTimer:  ReturnType<typeof setInterval> | null = null;
  private reconnects: number = 0;
  private shouldRun:  boolean = false;
  /** Har reconnect/switch da oshadi — eski socket hodisalari e'tiborsiz qoldiriladi */
  private epoch:      number = 0;

  /** @deprecated connectAsync ishlating */
  connect(token: string): void {
    void this.connectAsync(token);
  }

  /** @deprecated disconnectAsync ishlating */
  disconnect(): void {
    void this.disconnectAsync();
  }

  /** Eski ulanishni to'liq yopadi (account switch uchun majburiy) */
  disconnectAsync(): Promise<void> {
    this.shouldRun = false;
    this.epoch++;
    this._stopPing();

    const sock = this.socket;
    this.socket = null;

    if (!sock || sock.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DISCONNECT_TIMEOUT);
      sock.onopen    = null;
      sock.onmessage = null;
      sock.onerror   = null;
      sock.onclose   = () => {
        clearTimeout(timer);
        resolve();
      };
      if (sock.readyState < WebSocket.CLOSING) {
        sock.close(1000, "account_switch");
      } else {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /** Avval disconnect, keyin yangi token bilan ulanish */
  async connectAsync(token: string): Promise<void> {
    await this.disconnectAsync();
    this.token     = token;
    this.shouldRun = true;
    this.reconnects = 0;
    await this._openAndWait();
  }

  send(type: string, payload: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  }

  sendRaw(data: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private _openAndWait(): Promise<void> {
    const myEpoch = this.epoch;
    const url     = `${getWsEndpoint()}?token=${encodeURIComponent(this.token)}`;

    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url);
      this.socket = sock;

      const fail = (err: string) => {
        if (myEpoch !== this.epoch) return;
        reject(new Error(err));
      };

      sock.onopen = () => {
        if (myEpoch !== this.epoch) {
          sock.close();
          return;
        }
        this.reconnects = 0;
        this._startPing();
        console.log("[WS] ✅ Ulandi (epoch=" + myEpoch + ")");
        resolve();
      };

      sock.onmessage = (e) => {
        if (myEpoch !== this.epoch) return;
        try {
          const event = JSON.parse(e.data as string) as WsEvent;
          this.handlers.forEach((h) => h(event));
        } catch {
          /* noto'g'ri JSON */
        }
      };

      sock.onclose = () => {
        if (myEpoch !== this.epoch) return;
        this._stopPing();
        if (this.socket === sock) this.socket = null;
        if (this.shouldRun && this.reconnects < MAX_RECONNECTS) {
          this.reconnects++;
          const delay = RECONNECT_DELAY_MS * this.reconnects;
          console.log(`[WS] Qayta ulanish ${this.reconnects}/${MAX_RECONNECTS} (${delay}ms)`);
          setTimeout(() => {
            if (this.shouldRun && this.epoch === myEpoch) {
              void this._openAndWait().catch(() => {});
            }
          }, delay);
        }
      };

      sock.onerror = () => fail("WebSocket xatoligi");
    });
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.sendRaw({ type: "ping" });
    }, PING_INTERVAL_MS);
  }

  private _stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export const wsClient = new WsClient();
