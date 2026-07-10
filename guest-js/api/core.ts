// MIT License
// Copyright (c) 2025 DraviaVemal
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient, { type WsStats } from "../src/ws.js";
import { wsInvoke } from "../src/ws-invoke.js";
export type { WsStats };

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function setBaseUrl(url: string) {
  wsClient.setUrl(url);
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return tauriInvoke<T>(cmd, args);
  }
  return wsInvoke<T>(cmd, args);
}

export function getWsStatus(): string {
  return wsClient.getStatus();
}

export function onWsStatusChange(cb: (status: string) => void): () => void {
  return wsClient.onStatusChange(cb);
}

export function getWsStats(): WsStats {
  return wsClient.getStats();
}

export { initFloatingBadge, disableFloatingBadge } from "../src/floating-badge.js";
export type { FloatingBadgeOptions } from "../src/floating-badge.js";
