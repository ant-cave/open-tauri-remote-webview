type MessageHandler = (data: string) => void;

export interface WsStats {
  status: string;
  url: string | null;
  connectCount: number;
  reconnectCount: number;
  uptime: number | null;
  lastError: string | null;
  latency: number | null;
  logs: string[];
}

const MAX_LOGS = 50;
let wsLogs: string[] = [];

export function getWsLogs(): string[] {
  return wsLogs;
}

// Frontend log helper — format: [YYYY-MM-DD][HH:MM:SS][module][ws.ts][level] message
function wsLog(level: string, module: string, message: string) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const logStr = `[${dateStr}][${timeStr}][${module}][ws.ts][${level}] ${message}`;
  wsLogs.push(logStr);
  if (wsLogs.length > MAX_LOGS) wsLogs.shift();
  switch (level) {
    case "ERROR":
      console.error(logStr);
      break;
    case "WARN":
      console.warn(logStr);
      break;
    default:
      console.log(logStr);
  }
}

type StatusCallback = (status: string) => void;

let _connIdCounter = 0;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private port: number | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private sendQueue: string[] = [];
  private connectAttempts = 0;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connecting = false;
  private _reconnecting = false;
  private _currentConnId = 0;

  private _connectCount = 0;
  private _connectTimestamp: number | null = null;
  private _lastError: string | null = null;
  private _latency: number | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HEARTBEAT_INTERVAL = 5000;
  private readonly PONG_TIMEOUT = 3000;

  getStats(): WsStats {
    return {
      status: this.getStatus(),
      url: this.url,
      connectCount: this._connectCount,
      reconnectCount: Math.max(0, this.connectAttempts - this._connectCount),
      uptime: this.ws && this.ws.readyState === WebSocket.OPEN && this._connectTimestamp
        ? Date.now() - this._connectTimestamp : null,
      lastError: this._lastError,
      latency: this._latency,
      logs: getWsLogs(),
    };
  }

  setLatency(ms: number) {
    this._latency = ms;
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.statusCallbacks.add(cb);
    // 立即通知当前状态
    cb(this.getStatus());
    return () => this.statusCallbacks.delete(cb);
  }

  private notifyStatus(status: string) {
    for (const cb of this.statusCallbacks) {
      try { cb(status); } catch { /* ignore */ }
    }
  }

  getStatus(): string {
    if (!this.ws) return "disconnected";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return "connecting";
      case WebSocket.OPEN: return "connected";
      case WebSocket.CLOSING: return "closing";
      case WebSocket.CLOSED: return "disconnected";
      default: return "unknown";
    }
  }

  setUrl(url: string) {
    wsLog("INFO", "WsClient.setUrl", `setting WebSocket URL: ${url}`);
    this.url = url;
    // URL takes priority over port; clear port when setting URL
    this.port = null;
    // URL 变了，之前的连接请求是针对旧地址的，取消等待
    this._connecting = false;
  }

  setPort(port: number) {
    wsLog("INFO", "WsClient.setPort", `setting WebSocket port: ${port}`);
    this.port = port;
    // port needs to reconstruct URL; if url is already set, clear it (url takes priority)
    this.url = null;
    this._connecting = false;
  }

  getPort(): number | null {
    return this.port;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    wsLog("INFO", "WsClient.scheduleReconnect",
      `attempting reconnect after ${this.reconnectDelay}ms... (current status=${this.getStatus()}, _connecting=${this._connecting}, _reconnecting=${this._reconnecting})`);
    this.notifyStatus("connecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = 1000;
  }

  private detectUrl(): string {
    if (this.url) {
      wsLog("DEBUG", "WsClient.detectUrl", `using preset URL: ${this.url}`);
      return this.url;
    }
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    // if port is set, construct URL using the preset port
    if (this.port) {
      const hostname = loc.hostname || "localhost";
      const url = `${proto}//${hostname}:${this.port}/remote_ui_ws`;
      wsLog("DEBUG", "WsClient.detectUrl", `constructing WebSocket URL from preset port: ${url}`);
      return url;
    }
    // otherwise use the current page host (with port)
    const url = `${proto}//${loc.host}/remote_ui_ws`;
    wsLog("DEBUG", "WsClient.detectUrl", `auto-detected WebSocket URL: ${url}`);
    return url;
  }

  connect(): Promise<void> {
    this._reconnecting = false;
    // Cancel any pending reconnect timer so we don't get parallel connections
    this.cancelReconnect();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      wsLog("INFO", "WsClient.connect", "WebSocket already in OPEN state, skipping connection");
      return Promise.resolve();
    }
    if (this._connecting) {
      wsLog("DEBUG", "WsClient.connect", "connection already in progress, waiting...");
      return new Promise((resolve) => {
        // onStatusChange 会同步调用回调，此时 unsub 还未赋值。
        // 用 flag 跳过首次同步回调，只处理后续异步状态变更。
        let ready = false;
        let unsub: (() => void) | undefined;
        unsub = this.onStatusChange((status) => {
          if (!ready) { ready = true; return; }
          if (status === "connected") {
            if (unsub) unsub();
            resolve();
          } else if (status === "disconnected" || status === "error") {
            if (unsub) unsub();
            this.connect().then(resolve).catch(() => {});
          }
        });
      });
    }
    this._connecting = true;
    this.connectAttempts++;
    const connId = ++_connIdCounter;
    this._currentConnId = connId;
    wsLog("INFO", "WsClient.connect", `starting WebSocket connection (connId=${connId}, attempt #${this.connectAttempts})...`);
    return new Promise((resolve, reject) => {
      const url = this.detectUrl();
      wsLog("INFO", "WsClient.connect", `creating WebSocket connection (connId=${connId}): ${url}`);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        wsLog("INFO", "WsClient.connect:onopen", `WebSocket connection opened (connId=${connId}, attempt #${this.connectAttempts})`);
        this._connecting = false;
        this._connectCount++;
        this._connectTimestamp = Date.now();
        this.cancelReconnect();
        this.notifyStatus("connected");
        this.ws = ws;
        const queueLen = this.sendQueue.length;
        if (queueLen > 0) {
          wsLog("INFO", "WsClient.connect:onopen", `draining send queue (${queueLen} queued messages)`);
        }
        this.drainQueue();
        this.startHeartbeat();
        resolve();
      };
      ws.onmessage = (event) => {
        wsLog("DEBUG", "WsClient.connect:onmessage", `received WebSocket message (${typeof event.data})`);
        this.dispatchMessage(event);
      };
      ws.onclose = (event) => {
        const isCurrent = this.ws === ws;
        wsLog("WARN", "WsClient.connect:onclose",
          `WebSocket connection closed (connId=${connId}, isCurrent=${isCurrent}): code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean}`);
        if (isCurrent) {
          this._connecting = false;
          this._reconnecting = true;
          this.stopHeartbeat();
          this.ws = null;
          this.notifyStatus("disconnected");
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        } else {
          wsLog("DEBUG", "WsClient.connect:onclose", `ignoring close event from non-current instance (connId=${connId}, currentConnId=${this._currentConnId})`);
        }
      };
      ws.onerror = (event) => {
        wsLog("ERROR", "WsClient.connect:onerror", `WebSocket connection error (connId=${connId}): ${url}`);
        this._lastError = `connection error: ${url}`;
        if (this.ws === ws) {
          this._connecting = false;
          this._reconnecting = true;
          this.stopHeartbeat();
          this.ws = null;
          this.notifyStatus("error");
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        } else {
          wsLog("DEBUG", "WsClient.connect:onerror", `ignoring error event from non-current instance (connId=${connId})`);
        }
        reject(new Error(`WebSocket connection failed: ${url}`));
      };
    });
  }

  private drainQueue() {
    const count = this.sendQueue.length;
    if (count > 0) {
      wsLog("INFO", "WsClient.drainQueue", `starting to drain send queue: ${count} messages`);
    }
    for (const msg of this.sendQueue) {
      wsLog("DEBUG", "WsClient.drainQueue", `queued message (${msg.length} bytes): ${msg.substring(0, 100)}`);
      this.ws!.send(msg);
    }
    this.sendQueue = [];
    if (count > 0) {
      wsLog("INFO", "WsClient.drainQueue", `queue drained: ${count} messages sent`);
    }
  }

  private sendPing() {
    const ready = this.ws?.readyState;
    wsLog("DEBUG", "WsClient.heartbeat", `sending ping (ws=${this.ws !== null}, readyState=${ready})`);
    if (this.ws && ready === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch (e) {
        wsLog("ERROR", "WsClient.heartbeat", `ping send failed: ${e}`);
      }
      this.pongTimer = setTimeout(() => {
        wsLog("WARN", "WsClient.heartbeat", "pong timeout, closing connection to trigger reconnect");
        this.ws?.close();
      }, this.PONG_TIMEOUT);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // Send first ping immediately to detect idle timeout
    this.sendPing();
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private dispatchMessage(event: MessageEvent) {
    const raw = typeof event.data === "string" ? event.data : event.data;
    // Intercept pong heartbeat responses
    if (typeof raw === "string") {
      try {
        const obj = JSON.parse(raw);
        if (obj && obj.type === "pong") {
          wsLog("DEBUG", "WsClient.dispatchMessage", "received pong, heartbeat ok");
          if (this.pongTimer !== null) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
          }
          return;
        }
      } catch { /* not JSON, forward to handlers */ }
    }
    const data = raw as string;
    const handlerCount = this.handlers.size;
    wsLog("DEBUG", "WsClient.dispatchMessage", `dispatching message to ${handlerCount} handlers (${data.length} bytes)`);
    for (const handler of this.handlers) {
      try {
        handler(data);
      } catch (err) {
        wsLog("ERROR", "WsClient.dispatchMessage", `message handler error: ${err}`);
      }
    }
  }

  send(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      wsLog("DEBUG", "WsClient.send", `sending directly (connId=${this._currentConnId}, ${data.length} bytes): ${data.substring(0, 100)}`);
      this.ws.send(data);
    } else {
      const state = this.ws ? this.ws.readyState : "null";
      wsLog("WARN", "WsClient.send", `WebSocket not ready (connId=${this._currentConnId}, state=${state}, _reconnecting=${this._reconnecting}), queueing message (${data.length} bytes)`);
      this.sendQueue.push(data);
      if (!this._reconnecting && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
        wsLog("INFO", "WsClient.send", `WebSocket is closed, calling connect() immediately (state=${state})`);
        this.connect();
      }
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    wsLog("DEBUG", "WsClient.onMessage", `registering message handler, total handlers: ${this.handlers.size}`);
    return () => {
      this.handlers.delete(handler);
      wsLog("DEBUG", "WsClient.onMessage:unsubscribe", `unregistered message handler, remaining handlers: ${this.handlers.size}`);
    };
  }

  close() {
    wsLog("INFO", "WsClient.close", "closing WebSocket connection...");
    this.shouldReconnect = false;
    this.cancelReconnect();
    this.stopHeartbeat();
    this.sendQueue = [];
    if (this.ws) {
      wsLog("INFO", "WsClient.close", `closing WebSocket (readyState=${this.ws.readyState})`);
      this.ws.close();
      this.ws = null;
      wsLog("INFO", "WsClient.close", "WebSocket reference set to null");
    } else {
      wsLog("WARN", "WsClient.close", "close() called but ws reference is null");
    }
  }

  isConnected(): boolean {
    const connected = this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    wsLog("DEBUG", "WsClient.isConnected", `connection status: ${connected} (ws=${this.ws !== null}, readyState=${this.ws?.readyState})`);
    return connected;
  }
}

// Track page lifecycle to detect reloads
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => wsLog("WARN", "WsClient", "page about to unload (beforeunload)"));
  window.addEventListener("pagehide", () => wsLog("WARN", "WsClient", "page hidden/unloaded (pagehide)"));
  window.addEventListener("freeze", () => wsLog("WARN", "WsClient", "page frozen (freeze)"));

  // Intercept native WebSocket close to log every call
  const OrigClose = WebSocket.prototype.close;
  WebSocket.prototype.close = function interceptedClose(code?: number, reason?: string) {
    const stack = new Error().stack || "";
    wsLog("ERROR", "WsClient", `WebSocket.close() called! code=${code}, reason="${reason}"\n${stack}`);
    return OrigClose.call(this, code, reason);
  };
}

const wsClient = new WsClient();
export default wsClient;
