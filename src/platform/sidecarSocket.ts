import type { WebSocketLike } from "./connection.ts";

// The sidecar WebSocket of Tauri builds, run by Rust (src-tauri/src/sidecar_socket.rs):
// a game host may reset TLS handshakes that carry SNI, and the webview cannot omit it.
// This adapter gives WebSocketSidecarConnection the browser WebSocket surface it uses,
// with the same close semantics (1006 when no close frame arrived).

export type SidecarSocketEvent =
  | { kind: "open" }
  | { kind: "message"; data: string }
  | { kind: "close"; code: number; reason: string };

/** The Rust commands behind one socket; injectable for tests. */
export type SidecarSocketIpc = {
  open(url: string, onEvent: (event: SidecarSocketEvent) => void): Promise<number>;
  send(id: number, data: string): Promise<void>;
  close(id: number, code: number, reason: string): Promise<void>;
};

export const tauriSidecarSocketIpc: SidecarSocketIpc = {
  async open(url, onEvent) {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const channel = new Channel<SidecarSocketEvent>();
    channel.onmessage = onEvent;
    return invoke<number>("sidecar_open", { url, onEvent: channel });
  },
  async send(id, data) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sidecar_send", { id, data });
  },
  async close(id, code, reason) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sidecar_close", { id, code, reason });
  },
};

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class TauriSidecarSocket implements WebSocketLike {
  readyState: number = CONNECTING;
  onopen: WebSocket["onopen"] = null;
  onmessage: WebSocket["onmessage"] = null;
  onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null;
  private readonly ipc: SidecarSocketIpc;
  // Commands go out one after another so frames keep their order.
  private queue: Promise<number | null>;

  constructor(url: string, ipc: SidecarSocketIpc = tauriSidecarSocketIpc) {
    this.ipc = ipc;
    this.queue = ipc.open(url, (event) => this.receive(event)).catch((error: unknown) => {
      console.error("SLGO: sidecar socket failed to open", error);
      this.receive({ kind: "close", code: 1006, reason: "" });
      return null;
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState === CONNECTING) throw new Error("socket is not open");
    if (this.readyState !== OPEN) return;
    if (typeof data !== "string") throw new Error("the sidecar socket sends text only");
    this.enqueue((id) => this.ipc.send(id, data));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === CLOSING || this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    this.enqueue((id) => this.ipc.close(id, code, reason));
  }

  private enqueue(command: (id: number) => Promise<void>) {
    this.queue = this.queue.then(async (id) => {
      if (id !== null) await command(id).catch((error: unknown) => console.error("SLGO: sidecar socket command failed", error));
      return id;
    });
  }

  // Handlers are typed with `this: WebSocket`; they only ever read the event.
  private get asWebSocket() { return this as unknown as WebSocket; }

  private receive(event: SidecarSocketEvent) {
    if (this.readyState === CLOSED) return;
    switch (event.kind) {
      case "open":
        if (this.readyState !== CONNECTING) return;
        this.readyState = OPEN;
        this.onopen?.call(this.asWebSocket, { type: "open" } as Event);
        return;
      case "message":
        if (this.readyState !== OPEN) return;
        this.onmessage?.call(this.asWebSocket, { type: "message", data: event.data } as MessageEvent);
        return;
      case "close":
        this.readyState = CLOSED;
        if (event.code === 1006) this.onerror?.call(this.asWebSocket, { type: "error" } as Event);
        this.onclose?.call(this.asWebSocket, { type: "close", code: event.code, reason: event.reason, wasClean: event.code !== 1006 } as CloseEvent);
        return;
    }
  }
}

export const createTauriSidecarSocket = (url: string): WebSocketLike => new TauriSidecarSocket(url);
