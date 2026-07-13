// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient from "./ws.js";
import * as logger from "./logger.js";

const MODULE = "ws-event";
logger.info(MODULE, "=== module loading ===");

const listeners = new Map<string, Set<(payload: unknown) => void>>();
logger.debug(MODULE, "event listener map initialized");

logger.info(MODULE, "registering WebSocket message handler (event dispatch)");
wsClient.onMessage((data: string) => {
  logger.debug(MODULE, `<<< received WebSocket message, size: ${data.length} bytes, attempting to parse as event...`);

  let msg: unknown;
  try {
    msg = JSON.parse(data);
    logger.debug(MODULE, "message JSON parsed successfully");
  } catch (e) {
    logger.debug(MODULE, `message JSON parsing failed, may not be an event message: ${e}`);
    return;
  }

  if (typeof msg !== "object" || msg === null) {
    logger.debug(MODULE, "message is not a valid object, ignoring");
    return;
  }

  const record = msg as Record<string, unknown>;

  if ("event" in record && typeof record.event === "string") {
    const eventName = record.event;
    logger.info(MODULE, `<<< received event message: event="${eventName}"`);
    logger.debug(MODULE, `event "${eventName}" payload type: ${typeof record.payload}`);

    const set = listeners.get(eventName);
    if (!set) {
      logger.debug(MODULE, `event "${eventName}" has no registered listeners, ignoring`);
      return;
    }
    logger.info(MODULE, `event "${eventName}" has ${set.size} listeners, starting dispatch`);
    let handlerIndex = 0;
    for (const handler of set) {
      handlerIndex++;
      try {
        logger.debug(MODULE, `event "${eventName}" invoking listener #${handlerIndex}`);
        handler(record.payload);
        logger.debug(MODULE, `event "${eventName}" listener #${handlerIndex} invoked successfully`);
      } catch (err) {
        logger.error(MODULE, `event "${eventName}" listener #${handlerIndex} execution error: ${err}`);
      }
    }
    logger.info(MODULE, `event "${eventName}" dispatch complete, ${handlerIndex} listeners`);
  } else {
    logger.debug(MODULE, "message does not contain event field, not an event message, ignoring");
  }
});
logger.info(MODULE, "WebSocket event message handler registered");

export function addEventListener(event: string, handler: (payload: unknown) => void): () => void {
  logger.info(MODULE, `>>> addEventListener() event="${event}"`);

  if (!listeners.has(event)) {
    logger.debug(MODULE, `event "${event}" first registration, creating listener set`);
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(handler);
  logger.info(MODULE, `event "${event}" listener registered, current listener count for this event: ${listeners.get(event)!.size}`);
  logger.debug(MODULE, `currently registered event types: [${Array.from(listeners.keys()).join(", ")}]`);

  // Ensure WS is connected so events can arrive (noop if already open)
  logger.debug(MODULE, `ensuring WebSocket connection (preparing to receive event "${event}")`);
  wsClient.connect();

  return () => {
    logger.info(MODULE, `>>> removeEventListener() event="${event}"`);
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
      logger.debug(MODULE, `event "${event}" listener removed, remaining listeners: ${set.size}`);
      if (set.size === 0) {
        listeners.delete(event);
        logger.info(MODULE, `event "${event}" has no remaining listeners, removing from map`);
      }
    } else {
      logger.warn(MODULE, `attempted to remove listener for event "${event}" but no registration found`);
    }
    logger.debug(MODULE, `currently registered event types: [${Array.from(listeners.keys()).join(", ")}]`);
  };
}

logger.info(MODULE, "=== module loading complete ===");
