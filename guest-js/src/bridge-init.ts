// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

/**
 * Side-effect module: auto-installs `__TAURI_INTERNALS__` shim in browser
 * and pre-warms the WebSocket connection.
 *
 * Usage: add `import "open-tauri-remote-webview/bridge-init"` once at your app entry
 * (before any @tauri-apps/api usage). No other code changes needed.
 *
 * Environment detection strategy:
 *   1. If `__ORUI_WS_URL__` or `__ORUI_WS_PORT__` is set → browser mode (user explicitly wants WS)
 *   2. If `__TAURI_INTERNALS__` is set (and not our shim) → native Tauri mode
 *   3. Otherwise → browser mode (assume WS bridge)
 */
import { installTauriBridge } from "./tauri-internals.js";
import { initFloatingBadge } from "./floating-badge.js";
import wsClient from "./ws.js";
import * as logger from "./logger.js";
import { setNativeTauri } from "./environment.js";

const MODULE = "bridge-init";

function hasWsOverride(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.__ORUI_WS_URL__ === "string" || typeof w.__ORUI_WS_PORT__ === "number";
}

function hasNativeTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!w.__TAURI_INTERNALS__ && !w.__TAURI_REMOTE_UI_SHIM__;
}

(async () => {
  // Priority 1: explicit WS override → browser mode
  if (hasWsOverride()) {
    logger.info(MODULE, "Detected WS URL/port override → browser mode");
    setNativeTauri(false);

    const urlOverride = (window as unknown as Record<string, unknown>).__ORUI_WS_URL__;
    const portOverride = (window as unknown as Record<string, unknown>).__ORUI_WS_PORT__;

    if (typeof urlOverride === "string") {
      wsClient.setUrl(urlOverride);
    } else if (typeof portOverride === "number") {
      wsClient.setPort(portOverride);
    }

    installTauriBridge();
    wsClient.connect();

    const badgeDisabled = !!(window as unknown as Record<string, unknown>).__ORUI_DISABLE_BADGE__;
    if (!badgeDisabled) initFloatingBadge();
    return;
  }

  // Priority 2: native Tauri detected
  if (hasNativeTauri()) {
    logger.info(MODULE, "Native Tauri detected → skip bridge, use real IPC");
    setNativeTauri(true);
    return;
  }

  // Priority 3: browser mode (default)
  logger.info(MODULE, "No native Tauri detected → browser mode with WS bridge");
  setNativeTauri(false);
  installTauriBridge();
  wsClient.connect();

  const badgeDisabled = !!(window as unknown as Record<string, unknown>).__ORUI_DISABLE_BADGE__;
  if (!badgeDisabled) initFloatingBadge();
})();
