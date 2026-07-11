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

// Detect native Tauri BEFORE any shim installation.
// In a real Tauri WebView, __TAURI_INTERNALS__ is injected by the runtime itself,
// so IPC works natively and no WS bridge is needed.
const isNativeTauri =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ &&
  !(window as unknown as Record<string, unknown>).__TAURI_REMOTE_UI_SHIM__;

if (!isNativeTauri) {
  // Only configure and connect WS when running in a remote browser (not native Tauri)
  const urlOverride = (window as unknown as Record<string, unknown>).__ORUI_WS_URL__;
  const portOverride = (window as unknown as Record<string, unknown>).__ORUI_WS_PORT__;

  // URL priority is higher than port; if URL is set, ignore port
  if (typeof urlOverride === "string") {
    wsClient.setUrl(urlOverride);
  } else if (typeof portOverride === "number") {
    wsClient.setPort(portOverride);
  }

  // Pre-connect WebSocket so first invoke/listen is faster
  wsClient.connect().catch(() => {});
}

// Install the shim (no-op if __TAURI_INTERNALS__ already exists, i.e. native Tauri)
installTauriBridge();

// Show WS connection status badge only in remote browser
if (!isNativeTauri && !(window as unknown as Record<string, unknown>).__ORUI_DISABLE_BADGE__) {
  initFloatingBadge();
}
