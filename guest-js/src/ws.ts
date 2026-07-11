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
    wsLog("INFO", "WsClient.setUrl", `设置 WebSocket URL: ${url}`);
    this.url = url;
    // URL 变了，之前的连接请求是针对旧地址的，取消等待
    this._connecting = false;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    wsLog("INFO", "WsClient.scheduleReconnect",
      `${this.reconnectDelay}ms 后尝试重新连接... (当前连接状态=${this.getStatus()}, _connecting=${this._connecting}, _reconnecting=${this._reconnecting})`);
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
      wsLog("DEBUG", "WsClient.detectUrl", `使用预设 URL: ${this.url}`);
      return this.url;
    }
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${loc.host}/remote_ui_ws`;
    wsLog("DEBUG", "WsClient.detectUrl", `自动检测 WebSocket URL: ${url}`);
    return url;
  }

  connect(): Promise<void> {
    this._reconnecting = false;
    // Cancel any pending reconnect timer so we don't get parallel connections
    this.cancelReconnect();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      wsLog("INFO", "WsClient.connect", "WebSocket 已处于 OPEN 状态，跳过连接");
      return Promise.resolve();
    }
    if (this._connecting) {
      wsLog("DEBUG", "WsClient.connect", "连接已在进行中，等待完成...");
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
    wsLog("INFO", "WsClient.connect", `开始 WebSocket 连接 (connId=${connId}, 尝试 #${this.connectAttempts})...`);
    return new Promise((resolve, reject) => {
      const url = this.detectUrl();
      wsLog("INFO", "WsClient.connect", `创建 WebSocket 连接 (connId=${connId}): ${url}`);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        wsLog("INFO", "WsClient.connect:onopen", `WebSocket 连接已打开 (connId=${connId}, 尝试 #${this.connectAttempts})`);
        this._connecting = false;
        this._connectCount++;
        this._connectTimestamp = Date.now();
        this.cancelReconnect();
        this.notifyStatus("connected");
        this.ws = ws;
        const queueLen = this.sendQueue.length;
        if (queueLen > 0) {
          wsLog("INFO", "WsClient.connect:onopen", `排空发送队列 (${queueLen} 条积压消息)`);
        }
        this.drainQueue();
        this.startHeartbeat();
        resolve();
      };
      ws.onmessage = (event) => {
        wsLog("DEBUG", "WsClient.connect:onmessage", `收到 WebSocket 消息 (${typeof event.data})`);
        this.dispatchMessage(event);
      };
      ws.onclose = (event) => {
        const isCurrent = this.ws === ws;
        wsLog("WARN", "WsClient.connect:onclose",
          `WebSocket 连接关闭 (connId=${connId}, isCurrent=${isCurrent}): code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean}`);
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
          wsLog("DEBUG", "WsClient.connect:onclose", `忽略非当前实例的关闭事件 (connId=${connId}, currentConnId=${this._currentConnId})`);
        }
      };
      ws.onerror = (event) => {
        wsLog("ERROR", "WsClient.connect:onerror", `WebSocket 连接错误 (connId=${connId}): ${url}`);
        this._lastError = `连接错误: ${url}`;
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
          wsLog("DEBUG", "WsClient.connect:onerror", `忽略非当前实例的 error 事件 (connId=${connId})`);
        }
        reject(new Error(`WebSocket connection failed: ${url}`));
      };
    });
  }

  private drainQueue() {
    const count = this.sendQueue.length;
    if (count > 0) {
      wsLog("INFO", "WsClient.drainQueue", `开始排空发送队列: ${count} 条消息`);
    }
    for (const msg of this.sendQueue) {
      wsLog("DEBUG", "WsClient.drainQueue", `发送队列消息 (${msg.length} 字节): ${msg.substring(0, 100)}`);
      this.ws!.send(msg);
    }
    this.sendQueue = [];
    if (count > 0) {
      wsLog("INFO", "WsClient.drainQueue", `队列排空完成: ${count} 条消息已发送`);
    }
  }

  private sendPing() {
    const ready = this.ws?.readyState;
    wsLog("DEBUG", "WsClient.heartbeat", `发送 ping (ws=${this.ws !== null}, readyState=${ready})`);
    if (this.ws && ready === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch (e) {
        wsLog("ERROR", "WsClient.heartbeat", `ping 发送失败: ${e}`);
      }
      this.pongTimer = setTimeout(() => {
        wsLog("WARN", "WsClient.heartbeat", "pong 超时，关闭连接触发重连");
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
          wsLog("DEBUG", "WsClient.dispatchMessage", "收到 pong，心跳正常");
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
    wsLog("DEBUG", "WsClient.dispatchMessage", `分发消息到 ${handlerCount} 个处理器 (${data.length} 字节)`);
    for (const handler of this.handlers) {
      try {
        handler(data);
      } catch (err) {
        wsLog("ERROR", "WsClient.dispatchMessage", `消息处理器异常: ${err}`);
      }
    }
  }

  send(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      wsLog("DEBUG", "WsClient.send", `直接发送消息 (connId=${this._currentConnId}, ${data.length} 字节): ${data.substring(0, 100)}`);
      this.ws.send(data);
    } else {
      const state = this.ws ? this.ws.readyState : "null";
      wsLog("WARN", "WsClient.send", `WebSocket 未就绪 (connId=${this._currentConnId}, state=${state}, _reconnecting=${this._reconnecting})，消息加入队列 (${data.length} 字节)`);
      this.sendQueue.push(data);
      if (!this._reconnecting && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
        wsLog("INFO", "WsClient.send", `WebSocket 已关闭，立即调 connect() (state=${state})`);
        this.connect();
      }
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    wsLog("DEBUG", "WsClient.onMessage", `注册消息处理器，当前处理器总数: ${this.handlers.size}`);
    return () => {
      this.handlers.delete(handler);
      wsLog("DEBUG", "WsClient.onMessage:unsubscribe", `注销消息处理器，剩余处理器数: ${this.handlers.size}`);
    };
  }

  close() {
    wsLog("INFO", "WsClient.close", "关闭 WebSocket 连接...");
    this.shouldReconnect = false;
    this.cancelReconnect();
    this.stopHeartbeat();
    this.sendQueue = [];
    if (this.ws) {
      wsLog("INFO", "WsClient.close", `正在关闭 WebSocket (readyState=${this.ws.readyState})`);
      this.ws.close();
      this.ws = null;
      wsLog("INFO", "WsClient.close", "WebSocket 引用已置空");
    } else {
      wsLog("WARN", "WsClient.close", "close() 被调用但 ws 引用为 null");
    }
  }

  isConnected(): boolean {
    const connected = this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    wsLog("DEBUG", "WsClient.isConnected", `连接状态: ${connected} (ws=${this.ws !== null}, readyState=${this.ws?.readyState})`);
    return connected;
  }
}

// Track page lifecycle to detect reloads
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => wsLog("WARN", "WsClient", "页面即将卸载 (beforeunload)"));
  window.addEventListener("pagehide", () => wsLog("WARN", "WsClient", "页面被隐藏/卸载 (pagehide)"));
  window.addEventListener("freeze", () => wsLog("WARN", "WsClient", "页面被冻结 (freeze)"));

  // Intercept native WebSocket close to log every call
  const OrigClose = WebSocket.prototype.close;
  WebSocket.prototype.close = function interceptedClose(code?: number, reason?: string) {
    const stack = new Error().stack || "";
    wsLog("ERROR", "WsClient", `WebSocket.close() 被调用! code=${code}, reason="${reason}"\n${stack}`);
    return OrigClose.call(this, code, reason);
  };
}

const wsClient = new WsClient();
export default wsClient;
