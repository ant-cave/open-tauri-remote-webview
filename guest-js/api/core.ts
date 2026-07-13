// MIT License
// Copyright (c) 2025 DraviaVemal
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient, { type WsStats } from "../src/ws.js";
import { wsInvoke } from "../src/ws-invoke.js";
import * as logger from "../src/logger.js";
import { isNativeTauri } from "../src/environment.js";
export type { WsStats };

const MODULE = "api/core";
logger.info(MODULE, "=== module loading ===");

/** True when running inside the real Tauri WebView (not the browser shim). */
function isRealTauri(): boolean {
  const result = isNativeTauri();
  logger.debug(MODULE, `isRealTauri() check: ${result}`);
  return result;
}

export function setBaseUrl(url: string) {
  logger.info(MODULE, `>>> setBaseUrl() URL: ${url}`);
  wsClient.setUrl(url);
  logger.info(MODULE, "setBaseUrl() completed");
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  logger.debug(MODULE, `tauriInvoke() invoking native Tauri invoke [cmd="${cmd}"]`);
  const { invoke } = await import("@tauri-apps/api/core");
  logger.debug(MODULE, `@tauri-apps/api/core dynamic import completed`);
  const result = await invoke<T>(cmd, args);
  logger.debug(MODULE, `tauriInvoke() completed [cmd="${cmd}"]`);
  return result;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  logger.info(MODULE, `>>> invoke() [cmd="${cmd}"]`);
  logger.debug(MODULE, `invoke() args: ${JSON.stringify(args)}`);

  if (isRealTauri()) {
    logger.info(MODULE, `using native Tauri invoke [cmd="${cmd}"]`);
    const result = await tauriInvoke<T>(cmd, args);
    logger.info(MODULE, `invoke() completed (native mode) [cmd="${cmd}"]`);
    return result;
  }

  logger.info(MODULE, `using WebSocket invoke [cmd="${cmd}"]`);
  const result = await wsInvoke<T>(cmd, args);
  logger.info(MODULE, `invoke() completed (WS mode) [cmd="${cmd}"]`);
  return result;
}

export function getWsStatus(): string {
  const status = wsClient.getStatus();
  logger.debug(MODULE, `getWsStatus() returns: ${status}`);
  return status;
}

export function onWsStatusChange(cb: (status: string) => void): () => void {
  logger.info(MODULE, ">>> onWsStatusChange() registering status change listener");
  const unsub = wsClient.onStatusChange(cb);
  logger.info(MODULE, "status change listener registered");
  return unsub;
}

export function getWsStats(): WsStats {
  logger.debug(MODULE, ">>> getWsStats() fetching WebSocket stats");
  const stats = wsClient.getStats();
  logger.debug(MODULE, `stats: status=${stats.status}, latency=${stats.latency}, connects=${stats.connectCount}`);
  return stats;
}

export { initFloatingBadge, disableFloatingBadge } from "../src/floating-badge.js";
export type { FloatingBadgeOptions } from "../src/floating-badge.js";

logger.info(MODULE, "=== module loading complete ===");
