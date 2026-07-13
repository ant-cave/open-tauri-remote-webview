// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient from "./ws.js";
import * as logger from "./logger.js";

const MODULE = "ws-invoke";
logger.info(MODULE, "=== module loading ===");

let nextId = 1;
logger.debug(MODULE, `initial request ID counter: ${nextId}`);

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  sendTime: number;
}

const pending = new Map<number, PendingRequest>();
logger.debug(MODULE, "pending request map initialized");
logger.info(MODULE, "=== module loading complete ===");

const INVOKE_TIMEOUT = 30000;

export async function wsInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  logger.info(MODULE, `wsInvoke() start [id=${id}, cmd="${cmd}"]`);

  const request = { id, cmd, args };

  if (!wsClient.isConnected()) {
    logger.warn(MODULE, `[id=${id}] WebSocket not connected, connecting...`);
    await wsClient.connect();
  }

  return new Promise<T>((resolve, reject) => {
    const sendTime = Date.now();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`invoke timed out after ${INVOKE_TIMEOUT}ms: ${cmd}`));
    }, INVOKE_TIMEOUT);

    pending.set(id, {
      resolve: (value: unknown) => { clearTimeout(timer); resolve(value as T); },
      reject: (reason: unknown) => { clearTimeout(timer); reject(reason); },
      sendTime,
    });

    wsClient.send(JSON.stringify(request));
  });
}

logger.info(MODULE, "registering WebSocket message handler");
wsClient.onMessage((data: string) => {
  logger.debug(MODULE, `<<< received WebSocket message, size: ${data.length} bytes`);

  let msg: unknown;
  try {
    msg = JSON.parse(data);
    logger.debug(MODULE, "message JSON parsed successfully");
  } catch (e) {
    logger.warn(MODULE, `message JSON parsing failed: ${e}`);
    return;
  }

  if (typeof msg !== "object" || msg === null) {
    logger.warn(MODULE, "message is not a valid object, ignoring");
    return;
  }

  const record = msg as Record<string, unknown>;
  logger.debug(MODULE, `message fields: ${Object.keys(record).join(", ")}`);

  if ("id" in record && typeof record.id === "number") {
    const requestId = record.id;
    logger.info(MODULE, `<<< received response message [id=${requestId}]`);

    const pendingReq = pending.get(requestId);
    if (!pendingReq) {
      logger.warn(MODULE, `[id=${requestId}] no matching pending request found, may have timed out or duplicate response`);
      return;
    }
    pending.delete(requestId);
    logger.debug(MODULE, `[id=${requestId}] removed from pending queue, remaining queue size: ${pending.size}`);

    // measure round-trip delay
    const rtt = Date.now() - pendingReq.sendTime;
    logger.info(MODULE, `[id=${requestId}] round-trip delay (RTT): ${rtt}ms`);
    wsClient.setLatency(rtt);

    try {
      logger.debug(MODULE, `[id=${requestId}] attempting to parse payload...`);
      const payload = JSON.parse(record.payload as string);
      logger.debug(MODULE, `[id=${requestId}] payload parsed successfully, type: ${typeof payload}`);

      if (payload && typeof payload === "object" && "status" in payload) {
        const status = (payload as Record<string, unknown>).status;
        logger.debug(MODULE, `[id=${requestId}] payload contains status field: ${status}`);

        if (status === "success") {
          logger.info(MODULE, `[id=${requestId}] request succeeded, resolving response`);
          pendingReq.resolve((payload as Record<string, unknown>).payload);
        } else {
          logger.warn(MODULE, `[id=${requestId}] request failed, rejecting error: ${JSON.stringify((payload as Record<string, unknown>).payload)}`);
          pendingReq.reject((payload as Record<string, unknown>).payload);
        }
      } else {
        logger.info(MODULE, `[id=${requestId}] payload has no status field, resolving directly`);
        pendingReq.resolve(payload);
      }
    } catch (e) {
      logger.warn(MODULE, `[id=${requestId}] payload parsing failed, resolving with raw data: ${e}`);
      pendingReq.resolve(record.payload);
    }
  } else {
    logger.debug(MODULE, "message does not contain id field, ignoring");
  }
});
logger.info(MODULE, "WebSocket message handler registered");
