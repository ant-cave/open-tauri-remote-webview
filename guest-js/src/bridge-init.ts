// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

/**
 * Side-effect module: auto-installs `__TAURI_INTERNALS__` shim in browser
 * and pre-warms the WebSocket connection.
 *
 * Usage: add `import "open-tauri-remote-webview/bridge-init"` once at your app entry
 * (before any @tauri-apps/api usage). No other code changes needed.
 */
import { installTauriBridge } from "./tauri-internals.js";
import { initFloatingBadge } from "./floating-badge.js";
import wsClient from "./ws.js";

// Allow global URL override before import
if (typeof window !== "undefined") {
  const override = (window as unknown as Record<string, unknown>).__ORUI_WS_URL__;
  if (typeof override === "string") {
    wsClient.setUrl(override);
  }
}

installTauriBridge();

// Pre-connect WebSocket so first invoke/listen is faster (noop if already open)
// If URL is not set yet (custom port), first connect will fail gracefully
wsClient.connect().catch(() => {});

// Show WS connection status badge by default (only in remote browser, not in native Tauri webview)
// Set window.__ORUI_DISABLE_BADGE__ = true before importing bridge-init to suppress it
const isNativeTauri =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ &&
  !(window as unknown as Record<string, unknown>).__TAURI_REMOTE_UI_SHIM__;

if (!isNativeTauri && !(window as unknown as Record<string, unknown>).__ORUI_DISABLE_BADGE__) {
  initFloatingBadge();
}
