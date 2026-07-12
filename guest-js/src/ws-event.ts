// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient from "./ws.js";
import * as logger from "./logger.js";

const MODULE = "ws-event";
logger.info(MODULE, "=== 模块开始加载 ===");

const listeners = new Map<string, Set<(payload: unknown) => void>>();
logger.debug(MODULE, "事件监听器映射表已初始化");

logger.info(MODULE, "注册 WebSocket 消息处理器（事件分发）");
wsClient.onMessage((data: string) => {
  logger.debug(MODULE, `<<< 收到 WebSocket 消息，大小: ${data.length} 字节，尝试解析为事件...`);

  let msg: unknown;
  try {
    msg = JSON.parse(data);
    logger.debug(MODULE, "消息 JSON 解析成功");
  } catch (e) {
    logger.debug(MODULE, `消息 JSON 解析失败，可能非事件消息: ${e}`);
    return;
  }

  if (typeof msg !== "object" || msg === null) {
    logger.debug(MODULE, "消息不是有效对象，忽略");
    return;
  }

  const record = msg as Record<string, unknown>;

  if ("event" in record && typeof record.event === "string") {
    const eventName = record.event;
    logger.info(MODULE, `<<< 收到事件消息: event="${eventName}"`);
    logger.debug(MODULE, `事件 "${eventName}" payload 类型: ${typeof record.payload}`);

    const set = listeners.get(eventName);
    if (!set) {
      logger.debug(MODULE, `事件 "${eventName}" 无注册的监听器，忽略`);
      return;
    }
    logger.info(MODULE, `事件 "${eventName}" 有 ${set.size} 个监听器，开始分发`);
    let handlerIndex = 0;
    for (const handler of set) {
      handlerIndex++;
      try {
        logger.debug(MODULE, `事件 "${eventName}" 调用监听器 #${handlerIndex}`);
        handler(record.payload);
        logger.debug(MODULE, `事件 "${eventName}" 监听器 #${handlerIndex} 调用成功`);
      } catch (err) {
        logger.error(MODULE, `事件 "${eventName}" 监听器 #${handlerIndex} 执行异常: ${err}`);
      }
    }
    logger.info(MODULE, `事件 "${eventName}" 分发完成，共 ${handlerIndex} 个监听器`);
  } else {
    logger.debug(MODULE, "消息不包含 event 字段，非事件消息，忽略");
  }
});
logger.info(MODULE, "WebSocket 事件消息处理器注册完成");

export function addEventListener(event: string, handler: (payload: unknown) => void): () => void {
  logger.info(MODULE, `>>> addEventListener() event="${event}"`);

  if (!listeners.has(event)) {
    logger.debug(MODULE, `事件 "${event}" 首次注册，创建监听器集合`);
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(handler);
  logger.info(MODULE, `事件 "${event}" 监听器已注册，当前该事件监听器数量: ${listeners.get(event)!.size}`);
  logger.debug(MODULE, `当前已注册事件类型: [${Array.from(listeners.keys()).join(", ")}]`);

  // Ensure WS is connected so events can arrive (noop if already open)
  logger.debug(MODULE, `确保 WebSocket 连接（为事件 "${event}" 接收做准备）`);
  wsClient.connect();

  return () => {
    logger.info(MODULE, `>>> removeEventListener() event="${event}"`);
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
      logger.debug(MODULE, `事件 "${event}" 监听器已移除，剩余监听器数量: ${set.size}`);
      if (set.size === 0) {
        listeners.delete(event);
        logger.info(MODULE, `事件 "${event}" 无剩余监听器，从映射表中移除`);
      }
    } else {
      logger.warn(MODULE, `尝试移除事件 "${event}" 的监听器，但该事件无注册记录`);
    }
    logger.debug(MODULE, `当前已注册事件类型: [${Array.from(listeners.keys()).join(", ")}]`);
  };
}

logger.info(MODULE, "=== 模块加载完成 ===");
