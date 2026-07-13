// MIT License
// Copyright (c) 2025 DraviaVemal
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import { addEventListener } from "../src/ws-event.js";
import * as logger from "../src/logger.js";
import { isNativeTauri } from "../src/environment.js";

const MODULE = "api/event";
logger.info(MODULE, "=== module loading ===");

interface EventMessage<T> {
  payload: T;
}

type EventHandler<T> = (event: EventMessage<T>) => void;

/** True when running inside the real Tauri WebView (not the browser shim). */
function isRealTauri(): boolean {
  const result = isNativeTauri();
  logger.debug(MODULE, `isRealTauri() check: ${result}`);
  return result;
}

async function tauriListen<T>(event: string, handler: EventHandler<T>): Promise<() => void> {
  logger.debug(MODULE, `tauriListen() invoking native Tauri listen [event="${event}"]`);
  const { listen } = await import("@tauri-apps/api/event");
  logger.debug(MODULE, `@tauri-apps/api/event dynamic import completed`);
  const unsub = await listen<T>(event, handler);
  logger.debug(MODULE, `tauriListen() completed [event="${event}"]`);
  return unsub;
}

export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  logger.info(MODULE, `>>> listen() [event="${event}"]`);

  if (isRealTauri()) {
    logger.info(MODULE, `using native Tauri listen [event="${event}"]`);
    const unsub = await tauriListen<T>(event, handler);
    logger.info(MODULE, `listen() completed (native mode) [event="${event}"]`);
    return unsub;
  }

  logger.info(MODULE, `using WebSocket listen [event="${event}"]`);
  const unsub = addEventListener(event, (payload: unknown) => {
    logger.debug(MODULE, `event "${event}" triggered, calling user handler`);
    handler({ payload: payload as T });
  });
  logger.info(MODULE, `listen() completed (WS mode) [event="${event}"]`);
  return unsub;
}

async function tauriOnce<T>(event: string, handler: EventHandler<T>): Promise<() => void> {
  logger.debug(MODULE, `tauriOnce() invoking native Tauri once [event="${event}"]`);
  const { once } = await import("@tauri-apps/api/event");
  logger.debug(MODULE, `@tauri-apps/api/event dynamic import completed`);
  const unsub = await once<T>(event, handler);
  logger.debug(MODULE, `tauriOnce() completed [event="${event}"]`);
  return unsub;
}

export async function once<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  logger.info(MODULE, `>>> once() [event="${event}"]`);

  if (isRealTauri()) {
    logger.info(MODULE, `using native Tauri once [event="${event}"]`);
    const unsub = await tauriOnce<T>(event, handler);
    logger.info(MODULE, `once() completed (native mode) [event="${event}"]`);
    return unsub;
  }

  logger.info(MODULE, `using WebSocket once [event="${event}"]`);
  let unlisten: (() => void) | null = null;

  const wrappedHandler = (payload: unknown) => {
    logger.debug(MODULE, `once event "${event}" triggered, calling user handler`);
    handler({ payload: payload as T });
    if (unlisten) {
      logger.debug(MODULE, `once event "${event}" triggered, auto-unlistening`);
      unlisten();
    }
  };

  unlisten = addEventListener(event, wrappedHandler);
  logger.info(MODULE, `once() completed (WS mode) [event="${event}"]`);
  return unlisten;
}

logger.info(MODULE, "=== module loading complete ===");
