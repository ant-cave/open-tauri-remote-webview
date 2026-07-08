type MessageHandler = (data: string) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private sendQueue: string[] = [];

  setUrl(url: string) {
    this.url = url;
  }

  private detectUrl(): string {
    if (this.url) return this.url;
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${loc.host}/remote_ui_ws`;
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const url = this.detectUrl();
      const ws = new WebSocket(url);
      ws.onopen = () => {
        this.ws = ws;
        this.drainQueue();
        resolve();
      };
      ws.onmessage = (event) => this.dispatchMessage(event);
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
      };
      ws.onerror = () => {
        if (this.ws === ws) this.ws = null;
        reject(new Error(`WebSocket connection failed: ${url}`));
      };
    });
  }

  private drainQueue() {
    for (const msg of this.sendQueue) {
      this.ws!.send(msg);
    }
    this.sendQueue = [];
  }

  private dispatchMessage(event: MessageEvent) {
    const data = typeof event.data === "string" ? event.data : event.data;
    for (const handler of this.handlers) {
      handler(data as string);
    }
  }

  send(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.sendQueue.push(data);
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close() {
    this.sendQueue = [];
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

const wsClient = new WsClient();
export default wsClient;
