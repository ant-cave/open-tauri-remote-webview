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
logger.info(MODULE, "=== 模块开始加载 ===");

/** True when running inside the real Tauri WebView (not the browser shim). */
function isRealTauri(): boolean {
  const result = isNativeTauri();
  logger.debug(MODULE, `isRealTauri() 检测: ${result}`);
  return result;
}

export function setBaseUrl(url: string) {
  logger.info(MODULE, `>>> setBaseUrl() URL: ${url}`);
  wsClient.setUrl(url);
  logger.info(MODULE, "setBaseUrl() 完成");
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  logger.debug(MODULE, `tauriInvoke() 调用原生 Tauri invoke [cmd="${cmd}"]`);
  const { invoke } = await import("@tauri-apps/api/core");
  logger.debug(MODULE, `@tauri-apps/api/core 动态导入完成`);
  const result = await invoke<T>(cmd, args);
  logger.debug(MODULE, `tauriInvoke() 完成 [cmd="${cmd}"]`);
  return result;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  logger.info(MODULE, `>>> invoke() [cmd="${cmd}"]`);
  logger.debug(MODULE, `invoke() 参数: ${JSON.stringify(args)}`);

  if (isRealTauri()) {
    logger.info(MODULE, `使用原生 Tauri invoke [cmd="${cmd}"]`);
    const result = await tauriInvoke<T>(cmd, args);
    logger.info(MODULE, `invoke() 完成（原生模式）[cmd="${cmd}"]`);
    return result;
  }

  logger.info(MODULE, `使用 WebSocket invoke [cmd="${cmd}"]`);
  const result = await wsInvoke<T>(cmd, args);
  logger.info(MODULE, `invoke() 完成（WS 模式）[cmd="${cmd}"]`);
  return result;
}

export function getWsStatus(): string {
  const status = wsClient.getStatus();
  logger.debug(MODULE, `getWsStatus() 返回: ${status}`);
  return status;
}

export function onWsStatusChange(cb: (status: string) => void): () => void {
  logger.info(MODULE, ">>> onWsStatusChange() 注册状态变更监听器");
  const unsub = wsClient.onStatusChange(cb);
  logger.info(MODULE, "状态变更监听器已注册");
  return unsub;
}

export function getWsStats(): WsStats {
  logger.debug(MODULE, ">>> getWsStats() 获取 WebSocket 统计信息");
  const stats = wsClient.getStats();
  logger.debug(MODULE, `统计信息: status=${stats.status}, latency=${stats.latency}, connects=${stats.connectCount}`);
  return stats;
}

export { initFloatingBadge, disableFloatingBadge } from "../src/floating-badge.js";
export type { FloatingBadgeOptions } from "../src/floating-badge.js";

logger.info(MODULE, "=== 模块加载完成 ===");
