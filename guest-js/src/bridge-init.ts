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
import wsClient from "./ws.js";

installTauriBridge();

// Pre-connect WebSocket so first invoke/listen is faster (noop if already open)
// 如果 URL 还没设好（如自定义端口），首次连接会失败，但不影响后续
wsClient.connect().catch(() => {});
