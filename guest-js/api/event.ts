// MIT License
// Copyright (c) 2025 DraviaVemal
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import { addEventListener } from "../src/ws-event.js";
import * as logger from "../src/logger.js";
import { isNativeTauri } from "../src/environment.js";

const MODULE = "api/event";
logger.info(MODULE, "=== 模块开始加载 ===");

interface EventMessage<T> {
  payload: T;
}

type EventHandler<T> = (event: EventMessage<T>) => void;

/** True when running inside the real Tauri WebView (not the browser shim). */
function isRealTauri(): boolean {
  const result = isNativeTauri();
  logger.debug(MODULE, `isRealTauri() 检测: ${result}`);
  return result;
}

async function tauriListen<T>(event: string, handler: EventHandler<T>): Promise<() => void> {
  logger.debug(MODULE, `tauriListen() 调用原生 Tauri listen [event="${event}"]`);
  const { listen } = await import("@tauri-apps/api/event");
  logger.debug(MODULE, `@tauri-apps/api/event 动态导入完成`);
  const unsub = await listen<T>(event, handler);
  logger.debug(MODULE, `tauriListen() 完成 [event="${event}"]`);
  return unsub;
}

export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  logger.info(MODULE, `>>> listen() [event="${event}"]`);

  if (isRealTauri()) {
    logger.info(MODULE, `使用原生 Tauri listen [event="${event}"]`);
    const unsub = await tauriListen<T>(event, handler);
    logger.info(MODULE, `listen() 完成（原生模式）[event="${event}"]`);
    return unsub;
  }

  logger.info(MODULE, `使用 WebSocket listen [event="${event}"]`);
  const unsub = addEventListener(event, (payload: unknown) => {
    logger.debug(MODULE, `事件 "${event}" 触发，调用用户处理器`);
    handler({ payload: payload as T });
  });
  logger.info(MODULE, `listen() 完成（WS 模式）[event="${event}"]`);
  return unsub;
}

async function tauriOnce<T>(event: string, handler: EventHandler<T>): Promise<() => void> {
  logger.debug(MODULE, `tauriOnce() 调用原生 Tauri once [event="${event}"]`);
  const { once } = await import("@tauri-apps/api/event");
  logger.debug(MODULE, `@tauri-apps/api/event 动态导入完成`);
  const unsub = await once<T>(event, handler);
  logger.debug(MODULE, `tauriOnce() 完成 [event="${event}"]`);
  return unsub;
}

export async function once<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  logger.info(MODULE, `>>> once() [event="${event}"]`);

  if (isRealTauri()) {
    logger.info(MODULE, `使用原生 Tauri once [event="${event}"]`);
    const unsub = await tauriOnce<T>(event, handler);
    logger.info(MODULE, `once() 完成（原生模式）[event="${event}"]`);
    return unsub;
  }

  logger.info(MODULE, `使用 WebSocket once [event="${event}"]`);
  let unlisten: (() => void) | null = null;

  const wrappedHandler = (payload: unknown) => {
    logger.debug(MODULE, `once 事件 "${event}" 触发，调用用户处理器`);
    handler({ payload: payload as T });
    if (unlisten) {
      logger.debug(MODULE, `once 事件 "${event}" 已触发，自动取消监听`);
      unlisten();
    }
  };

  unlisten = addEventListener(event, wrappedHandler);
  logger.info(MODULE, `once() 完成（WS 模式）[event="${event}"]`);
  return unlisten;
}

logger.info(MODULE, "=== 模块加载完成 ===");
