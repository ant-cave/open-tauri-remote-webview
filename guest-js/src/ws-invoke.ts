// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient from "./ws.js";
import * as logger from "./logger.js";

const MODULE = "ws-invoke";
logger.info(MODULE, "=== 模块开始加载 ===");

let nextId = 1;
logger.debug(MODULE, `初始请求 ID 计数器: ${nextId}`);

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  sendTime: number;
}

const pending = new Map<number, PendingRequest>();
logger.debug(MODULE, "待处理请求映射已初始化");
logger.info(MODULE, "=== 模块加载完成 ===");

export async function wsInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  logger.info(MODULE, `>>> wsInvoke() 调用开始 [id=${id}, cmd="${cmd}"]`);
  logger.debug(MODULE, `[id=${id}] 参数: ${JSON.stringify(args)}`);

  const request = { id, cmd, args };
  logger.debug(MODULE, `[id=${id}] 请求对象已构建`);

  if (!wsClient.isConnected()) {
    logger.warn(MODULE, `[id=${id}] WebSocket 未连接，尝试建立连接...`);
    await wsClient.connect();
    logger.info(MODULE, `[id=${id}] WebSocket 连接已建立`);
  } else {
    logger.debug(MODULE, `[id=${id}] WebSocket 已连接，直接发送请求`);
  }

  return new Promise<T>((resolve, reject) => {
    const sendTime = Date.now();
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, sendTime });
    logger.debug(MODULE, `[id=${id}] 请求已加入待处理队列，当前队列大小: ${pending.size}`);

    const message = JSON.stringify(request);
    logger.debug(MODULE, `[id=${id}] 序列化消息大小: ${message.length} 字节`);
    wsClient.send(message);
    logger.info(MODULE, `[id=${id}] 请求已发送，等待响应...`);
  });
}

logger.info(MODULE, "注册 WebSocket 消息处理器");
wsClient.onMessage((data: string) => {
  logger.debug(MODULE, `<<< 收到 WebSocket 消息，大小: ${data.length} 字节`);

  let msg: unknown;
  try {
    msg = JSON.parse(data);
    logger.debug(MODULE, "消息 JSON 解析成功");
  } catch (e) {
    logger.warn(MODULE, `消息 JSON 解析失败: ${e}`);
    return;
  }

  if (typeof msg !== "object" || msg === null) {
    logger.warn(MODULE, "消息不是有效的对象，忽略");
    return;
  }

  const record = msg as Record<string, unknown>;
  logger.debug(MODULE, `消息字段: ${Object.keys(record).join(", ")}`);

  if ("id" in record && typeof record.id === "number") {
    const requestId = record.id;
    logger.info(MODULE, `<<< 收到响应消息 [id=${requestId}]`);

    const pendingReq = pending.get(requestId);
    if (!pendingReq) {
      logger.warn(MODULE, `[id=${requestId}] 未找到匹配的待处理请求，可能已超时或重复响应`);
      return;
    }
    pending.delete(requestId);
    logger.debug(MODULE, `[id=${requestId}] 从待处理队列中移除，剩余队列大小: ${pending.size}`);

    // 测量往返延迟
    const rtt = Date.now() - pendingReq.sendTime;
    logger.info(MODULE, `[id=${requestId}] 往返延迟 (RTT): ${rtt}ms`);
    wsClient.setLatency(rtt);

    try {
      logger.debug(MODULE, `[id=${requestId}] 尝试解析 payload...`);
      const payload = JSON.parse(record.payload as string);
      logger.debug(MODULE, `[id=${requestId}] payload 解析成功，类型: ${typeof payload}`);

      if (payload && typeof payload === "object" && "status" in payload) {
        const status = (payload as Record<string, unknown>).status;
        logger.debug(MODULE, `[id=${requestId}] payload 包含 status 字段: ${status}`);

        if (status === "success") {
          logger.info(MODULE, `[id=${requestId}] 请求成功，resolve 响应`);
          pendingReq.resolve((payload as Record<string, unknown>).payload);
        } else {
          logger.warn(MODULE, `[id=${requestId}] 请求失败，reject 错误: ${JSON.stringify((payload as Record<string, unknown>).payload)}`);
          pendingReq.reject((payload as Record<string, unknown>).payload);
        }
      } else {
        logger.info(MODULE, `[id=${requestId}] payload 无 status 字段，直接 resolve`);
        pendingReq.resolve(payload);
      }
    } catch (e) {
      logger.warn(MODULE, `[id=${requestId}] payload 解析失败，使用原始数据 resolve: ${e}`);
      pendingReq.resolve(record.payload);
    }
  } else {
    logger.debug(MODULE, "消息不包含 id 字段，忽略");
  }
});
logger.info(MODULE, "WebSocket 消息处理器注册完成");
