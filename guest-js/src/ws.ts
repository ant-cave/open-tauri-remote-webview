type MessageHandler = (data: string) => void;

// 前端日志辅助函数 — 格式: [年月日][时分秒][函数/模块][文件:行数][级别] 具体信息
function wsLog(level: string, module: string, message: string) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}时${String(now.getMinutes()).padStart(2, "0")}分${String(now.getSeconds()).padStart(2, "0")}秒`;
  const logStr = `[${dateStr}][${timeStr}][${module}][ws.ts][${level}] ${message}`;
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

class WsClient {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private sendQueue: string[] = [];
  /** WebSocket 连接尝试次数 (用于调试) */
  private connectAttempts = 0;

  setUrl(url: string) {
    wsLog("INFO", "WsClient.setUrl", `设置 WebSocket URL: ${url}`);
    this.url = url;
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      wsLog("INFO", "WsClient.connect", "WebSocket 已处于 OPEN 状态，跳过连接");
      return Promise.resolve();
    }
    this.connectAttempts++;
    wsLog("INFO", "WsClient.connect", `开始 WebSocket 连接 (尝试 #${this.connectAttempts})...`);
    return new Promise((resolve, reject) => {
      const url = this.detectUrl();
      wsLog("INFO", "WsClient.connect", `创建 WebSocket 连接: ${url}`);
      const ws = new WebSocket(url);
      ws.onopen = () => {
        wsLog("INFO", "WsClient.connect:onopen", `WebSocket 连接已打开 (尝试 #${this.connectAttempts})`);
        this.ws = ws;
        const queueLen = this.sendQueue.length;
        if (queueLen > 0) {
          wsLog("INFO", "WsClient.connect:onopen", `排空发送队列 (${queueLen} 条积压消息)`);
        }
        this.drainQueue();
        resolve();
      };
      ws.onmessage = (event) => {
        wsLog("DEBUG", "WsClient.connect:onmessage", `收到 WebSocket 消息 (${typeof event.data})`);
        this.dispatchMessage(event);
      };
      ws.onclose = (event) => {
        wsLog("WARN", "WsClient.connect:onclose",
          `WebSocket 连接关闭: code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean}`);
        if (this.ws === ws) {
          wsLog("INFO", "WsClient.connect:onclose", "当前 WebSocket 实例已关闭，清除引用");
          this.ws = null;
        } else {
          wsLog("DEBUG", "WsClient.connect:onclose", "忽略非当前实例的关闭事件");
        }
      };
      ws.onerror = (event) => {
        wsLog("ERROR", "WsClient.connect:onerror", `WebSocket 连接错误: ${url}`);
        if (this.ws === ws) {
          this.ws = null;
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

  private dispatchMessage(event: MessageEvent) {
    const data = typeof event.data === "string" ? event.data : event.data;
    const handlerCount = this.handlers.size;
    wsLog("DEBUG", "WsClient.dispatchMessage", `分发消息到 ${handlerCount} 个处理器 (${(data as string).length} 字节)`);
    for (const handler of this.handlers) {
      try {
        handler(data as string);
      } catch (err) {
        wsLog("ERROR", "WsClient.dispatchMessage", `消息处理器异常: ${err}`);
      }
    }
  }

  send(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      wsLog("DEBUG", "WsClient.send", `直接发送消息 (${data.length} 字节): ${data.substring(0, 100)}`);
      this.ws.send(data);
    } else {
      const state = this.ws ? this.ws.readyState : "null";
      wsLog("WARN", "WsClient.send", `WebSocket 未就绪 (state=${state})，消息加入队列 (${data.length} 字节)`);
      this.sendQueue.push(data);
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        wsLog("INFO", "WsClient.send", `WebSocket 已关闭 (state=${state})，尝试重新连接`);
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

const wsClient = new WsClient();
export default wsClient;
