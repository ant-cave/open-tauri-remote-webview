// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import { wsInvoke } from "./ws-invoke.js";
import { addEventListener } from "./ws-event.js";
import * as logger from "./logger.js";

const MODULE = "tauri-internals";
logger.info(MODULE, "=== 模块开始加载 ===");

/**
 * Manages callback IDs mapping for the __TAURI_INTERNALS__ shim.
 * Used by @tauri-apps/api internally for event listen/unlisten, Channel, etc.
 */
class ShimCallbackManager {
  private callbacks = new Map<number, (data: unknown) => void>();
  private nextId = 1;

  constructor() {
    logger.debug(MODULE, "ShimCallbackManager 实例已创建");
  }

  transformCallback<T = unknown>(
    callback?: (response: T) => void,
    once?: boolean,
  ): number {
    const id = this.nextId++;
    logger.debug(MODULE, `transformCallback() 注册回调 [id=${id}, once=${once}]`);
    this.callbacks.set(id, (data: unknown) => {
      logger.debug(MODULE, `执行回调 [id=${id}]`);
      if (once) {
        logger.debug(MODULE, `回调标记为 once，执行后移除 [id=${id}]`);
        this.callbacks.delete(id);
      }
      if (callback) {
        try {
          callback(data as T);
          logger.debug(MODULE, `回调执行成功 [id=${id}]`);
        } catch (err) {
          logger.error(MODULE, `回调执行异常 [id=${id}]: ${err}`);
        }
      }
    });
    logger.debug(MODULE, `当前回调总数: ${this.callbacks.size}`);
    return id;
  }

  unregisterCallback(id: number): void {
    logger.debug(MODULE, `unregisterCallback() [id=${id}]`);
    const existed = this.callbacks.has(id);
    this.callbacks.delete(id);
    logger.debug(MODULE, `回调移除${existed ? "成功" : "失败（不存在）"} [id=${id}]，剩余回调数: ${this.callbacks.size}`);
  }

  runCallback(id: number, data: unknown): void {
    logger.debug(MODULE, `runCallback() [id=${id}]`);
    const cb = this.callbacks.get(id);
    if (cb) {
      logger.debug(MODULE, `找到回调，执行 [id=${id}]`);
      cb(data);
    } else {
      logger.warn(MODULE, `回调不存在 [id=${id}]`);
    }
  }
}

/**
 * Installs `window.__TAURI_INTERNALS__` and `window.__TAURI_EVENT_PLUGIN_INTERNALS__`
 * in the browser context so that `@tauri-apps/api` modules work transparently
 * over the WebSocket bridge.
 *
 * Call this once before any `@tauri-apps/api` imports are used.
 */
export function installTauriBridge(): void {
  logger.info(MODULE, ">>> installTauriBridge() 开始执行");

  if (typeof window === "undefined") {
    logger.warn(MODULE, "window 对象不存在，跳过安装");
    return;
  }
  logger.debug(MODULE, "window 对象检查通过");

  // Already has a real Tauri runtime or shim already installed
  if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
    logger.warn(MODULE, "__TAURI_INTERNALS__ 已存在，跳过安装（可能是原生 Tauri 或已安装 shim）");
    return;
  }
  logger.debug(MODULE, "__TAURI_INTERNALS__ 不存在，继续安装流程");

  logger.info(MODULE, "创建 ShimCallbackManager 实例");
  const callbacks = new ShimCallbackManager();

  // Per-event, per-handlerId cleanup functions for intercepted plugin:event|listen
  logger.debug(MODULE, "初始化 handlerCleanups 映射表");
  const handlerCleanups = new Map<string, Map<number, () => void>>();

  // ── Intercepted commands ─────────────────────────────────
  // plugin:event|listen  →  register via WS event system
  // plugin:event|unlisten  →  unregister from WS event system
  // (everything else passes through to wsInvoke)

  logger.info(MODULE, "构建 shim 对象...");

  const shim = {
    invoke: async <T>(
      cmd: string,
      args?: Record<string, unknown>,
      _options?: Record<string, unknown>,
    ): Promise<T> => {
      logger.info(MODULE, `shim.invoke() [cmd="${cmd}"]`);
      logger.debug(MODULE, `shim.invoke() 参数: ${JSON.stringify(args)}`);

      if (cmd === "plugin:event|listen") {
        logger.info(MODULE, "拦截到 plugin:event|listen 命令");
        const event = args?.event as string;
        const handlerId = args?.handler as number;
        logger.debug(MODULE, `事件名称: "${event}", handlerId: ${handlerId}`);

        if (event && handlerId) {
          logger.info(MODULE, `注册事件监听器: event="${event}", handlerId=${handlerId}`);
          const unlisten = addEventListener(event, (payload: unknown) => {
            logger.debug(MODULE, `事件 "${event}" 触发，调用回调 [handlerId=${handlerId}]`);
            // Wrap in { payload: ... } to match @tauri-apps/api/event convention
            callbacks.runCallback(handlerId, { payload });
          });
          if (!handlerCleanups.has(event)) {
            logger.debug(MODULE, `为事件 "${event}" 创建清理函数映射`);
            handlerCleanups.set(event, new Map());
          }
          handlerCleanups.get(event)!.set(handlerId, unlisten);
          logger.debug(MODULE, `事件 "${event}" 的清理函数已注册 [handlerId=${handlerId}]`);
        } else {
          logger.warn(MODULE, `plugin:event|listen 参数不完整: event=${event}, handlerId=${handlerId}`);
        }
        logger.info(MODULE, "plugin:event|listen 处理完成，返回 undefined");
        return undefined as T;
      }

      if (cmd === "plugin:event|unlisten") {
        logger.info(MODULE, "拦截到 plugin:event|unlisten 命令");
        const event = args?.event as string;
        const eventId = args?.eventId as number;
        logger.debug(MODULE, `事件名称: "${event}", eventId: ${eventId}`);

        if (event && eventId) {
          logger.info(MODULE, `取消事件监听: event="${event}", eventId=${eventId}`);
          const cleanups = handlerCleanups.get(event);
          const unlisten = cleanups?.get(eventId);
          if (unlisten) {
            logger.debug(MODULE, `找到清理函数，执行取消监听 [event="${event}", eventId=${eventId}]`);
            unlisten();
            cleanups?.delete(eventId);
            logger.debug(MODULE, `清理函数已执行并移除 [event="${event}", eventId=${eventId}]`);
          } else {
            logger.warn(MODULE, `未找到清理函数 [event="${event}", eventId=${eventId}]`);
          }
        } else {
          logger.warn(MODULE, `plugin:event|unlisten 参数不完整: event=${event}, eventId=${eventId}`);
        }
        logger.info(MODULE, "plugin:event|unlisten 处理完成，返回 undefined");
        return undefined as T;
      }

      logger.info(MODULE, `普通命令调用，转发到 wsInvoke: cmd="${cmd}"`);
      const result = await wsInvoke<T>(cmd, args);
      logger.info(MODULE, `wsInvoke 调用完成: cmd="${cmd}"`);
      return result;
    },

    transformCallback: callbacks.transformCallback.bind(callbacks),
    unregisterCallback: callbacks.unregisterCallback.bind(callbacks),
    runCallback: callbacks.runCallback.bind(callbacks),

    convertFileSrc: (filePath: string, _protocol?: string): string => {
      logger.debug(MODULE, `convertFileSrc() [filePath="${filePath}", protocol=${_protocol || "未指定"}]`);
      logger.debug(MODULE, `convertFileSrc() 返回原始路径: "${filePath}"`);
      return filePath;
    },

    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },

    plugins: {
      path: {
        sep: navigator.platform.includes("Win") ? "\\" : "/",
        delimiter: navigator.platform.includes("Win") ? ";" : ":",
      },
    },
  };

  logger.debug(MODULE, "shim 对象构建完成");
  logger.debug(MODULE, `shim.metadata: ${JSON.stringify(shim.metadata)}`);
  logger.debug(MODULE, `shim.plugins.path: ${JSON.stringify(shim.plugins.path)}`);

  // Mark this as a shim so apps can distinguish from real Tauri runtime
  logger.info(MODULE, "设置 __TAURI_REMOTE_UI_SHIM__ = true（标记为 shim 环境）");
  (window as unknown as Record<string, unknown>).__TAURI_REMOTE_UI_SHIM__ = true;

  logger.info(MODULE, "安装 __TAURI_INTERNALS__ 到 window 对象");
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = shim;
  logger.debug(MODULE, "__TAURI_INTERNALS__ 安装完成");

  logger.info(MODULE, "安装 __TAURI_EVENT_PLUGIN_INTERNALS__ 到 window 对象");
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, eventId: number) => {
      logger.debug(MODULE, `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener() [event="${_event}", eventId=${eventId}]`);
      callbacks.unregisterCallback(eventId);
    },
  };
  logger.debug(MODULE, "__TAURI_EVENT_PLUGIN_INTERNALS__ 安装完成");

  logger.info(MODULE, "=== installTauriBridge() 执行完成 ===");
  logger.info(MODULE, "Tauri Bridge Shim 已成功安装到浏览器环境");
}

logger.info(MODULE, "=== 模块加载完成 ===");
