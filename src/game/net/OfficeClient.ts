import type { ClientMessage, OfficeEvent } from "../../shared/types.js";
import { officeLog, summarizeEvent } from "../../shared/trace.js";

type Handler = (event: OfficeEvent) => void;

export class OfficeClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private reconnectTimer: number | null = null;
  private shouldRun = false;
  private pending: ClientMessage[] = [];

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onEvent(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  connect(): void {
    this.shouldRun = true;
    this.open();
  }

  send(message: ClientMessage): void {
    officeLog("ws→", message.type, message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
  }

  close(): void {
    this.shouldRun = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      const queued = this.pending.splice(0);
      for (const msg of queued) ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(String(ev.data)) as OfficeEvent;
        officeLog("ws←", summarizeEvent(event));
        for (const handler of this.handlers) handler(event);
      } catch {
        /* ignore malformed */
      }
    };

    ws.onclose = () => {
      if (!this.shouldRun) return;
      this.reconnectTimer = window.setTimeout(() => this.open(), 1200);
    };

    ws.onerror = () => {
      ws.close();
    };
  }
}
