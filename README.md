# Open Tauri Remote WebView

[![crates.io](https://img.shields.io/crates/v/open-tauri-remote-webview)](https://crates.io/crates/open-tauri-remote-webview)
[![npm](https://img.shields.io/npm/v/open-tauri-remote-webview)](https://www.npmjs.com/package/open-tauri-remote-webview)

**Backend (Rust library):** `cargo add open-tauri-remote-webview` **（run in `src-tauri/`）**

**Frontend (JS):** `npm install open-tauri-remote-webview` **（run in project root）**

> **中文用户请查看 [中文文档](README.zh.md)** — 包含完整的使用指引。

---

## Why this plugin?

Building a Tauri app? Some things are **simply impossible** with native Tauri alone:

**"I want E2E tests with Playwright or Cypress, but they can't see Tauri's WebView."**
Playwright and Cypress control standard browsers. Tauri apps run inside the system WebView — invisible to these tools. This plugin exposes your app's UI through a standard WebSocket, so any web testing tool works out of the box.

**"My app needs to run on a headless server, but there's no display."**
Native Tauri requires a local display environment. You can't start it on a server and access the UI remotely. This plugin makes your app work like a web service — start it on the server, open it in any browser. No VNC, no remote desktop needed.

**"CI/CD UI testing is a nightmare — xvfb, display mocking, fragile setup."**
Testing native Tauri in CI requires virtual display setup and still can't integrate with web testing frameworks. This plugin lets your CI pipeline connect Playwright directly to your app, as simple as testing a regular website.

**"Every developer on the team needs the full Rust + Tauri toolchain just to work on the frontend."**
With this plugin, team members open a browser to see the app UI. No Rust installation, no Tauri environment setup. Frontend developers can work independently.

Long story short:

> **One import line, and your Tauri app works in a browser — none of the above is possible with native Tauri, and you don't change a single line of business logic.**

This project is based on [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
by [DraviaVemal](https://github.com/DraviaVemal), modified under the MIT license.
All modifications are Copyright (c) 2026 **ant-cave**. (MIT — use it, modify it, sell it. Just keep the copyright notice if you redistribute.)

---

## Features

| Capability | WebView (IPC) | Browser (WS) |
|---|---|---|
| `invoke` (any command) | ✅ | ✅ |
| Event `listen` / `once` | ✅ | ✅ |
| `@tauri-apps/api/app` (getName, getVersion, ...) | ✅ | ✅ via bridge |
| `@tauri-apps/api/window` (title, size, ...) | ✅ | ✅ via bridge |
| `@tauri-apps/api/event` (listen, emit) | ✅ | ✅ via bridge |
| Rust `emit` / `emit_to` / `emit_str` / ... → browser | ✅ | ✅ via `EmitterExt` |
| Custom security & origin control | ✅ | ✅ |
| WS connection status floating badge | — | ✅ auto-shown |

---

## API Compatibility with Native Tauri

Zero migration cost. All exported APIs have identical signatures to native Tauri:

### Rust side

| Native `tauri::Emitter` | This plugin `open_tauri_remote_webview::EmitterExt` | Difference |
|---|---|---|
| `fn emit(...)` **sync** | `fn emit(...)` **sync** ✅ | None |
| `fn emit_to(...)` sync | `fn emit_to(...)` sync ✅ | None |
| `fn emit_str(...)` sync | `fn emit_str(...)` sync ✅ | None |
| `fn emit_str_to(...)` sync | `fn emit_str_to(...)` sync ✅ | None |
| `fn emit_filter(...)` sync | `fn emit_filter(...)` sync ✅ | None |
| `fn emit_str_filter(...)` sync | `fn emit_str_filter(...)` sync ✅ | None |

**Implemented for:** `AppHandle<R>`, `WebviewWindow<R>`, **`Window<R>`** — all 6 emit methods work on all three types.

**Usage:** Simply replace `use tauri::Emitter` with `use open_tauri_remote_webview::EmitterExt` — all calls continue to work unchanged.

### JS side

| Native `@tauri-apps/api` | Bridge mode | Explicit API | Difference |
|---|---|---|---|
| `invoke<T>(cmd, args): Promise<T>` | Transparent proxy ✅ | `invoke<T>(cmd, args)` ✅ | None |
| `listen<T>(event, handler): Promise<() => void>` | Transparent proxy ✅ | `listen<T>(event, handler)` ✅ | None |
| `once<T>(event, handler): Promise<() => void>` | Transparent proxy ✅ | `once<T>(event, handler)` ✅ | None |

### Known limitations (architectural, not API differences)

- **Single-window mode only**: `getCurrentWindow()` always returns `label: "main"`
- **No asset protocol**: `convertFileSrc()` returns the path as-is; use raw URLs for assets
- **No `__TAURI__` env**: the bridge sets `__TAURI_REMOTE_UI_SHIM__` instead

---

## Migration from Native Tauri

Migrating an existing Tauri app requires only a few changes. Most of your frontend code stays **exactly the same**.

### What changes

| Area | Before (native Tauri) | After (remote) |
|---|---|---|
| Rust plugin | — | Add crate + `.plugin(open_tauri_remote_webview::init())` |
| Rust `emit()` (AppHandle / WebviewWindow / Window) | `use tauri::Emitter` | `use open_tauri_remote_webview::EmitterExt` (same call, sync) |
| Rust start WS server | — | Add `app.start_remote_ui(RemoteUiConfig::default())` in `setup` |
| Frontend install | — | `npm install open-tauri-remote-webview` |
| Frontend import | `import "..." from "@tauri-apps/api"` | **No change** — add `import "open-tauri-remote-webview/bridge-init"` at entry |
| `vite.config.ts` | — | Add `/remote_ui_ws` proxy |
| `if (isTauri())` guards | Common pattern | **Remove them** — bridge handles everything |

### Step-by-step

1. **Rust:** `cargo add open-tauri-remote-webview`, register the plugin and start the WS server in `setup` (see [Usage > Rust side](#1-rust-side)).
2. **Frontend:** `npm install open-tauri-remote-webview`, add `import "open-tauri-remote-webview/bridge-init"` at the top of your entry file.
3. **Vite:** Add the `/remote_ui_ws` proxy (see [Usage > Vite dev proxy](#4-vite-dev-proxy)).
4. **Clean up:** Delete all `isTauri()` / `isRunningInTauri()` branches — the bridge handles environment detection automatically.
5. **Recommended:** Replace `use tauri::Emitter` with `use open_tauri_remote_webview::EmitterExt` so backend events also reach browser clients.

### What stays the same

- All `@tauri-apps/api/*` imports and usage
- All Tauri command definitions on the Rust side
- All frontend build tooling (Vite, Webpack, etc.)
- All event `listen`/`once`/`emit` patterns
- All window and app API calls

---

## Usage

### 1. Rust side

```bash
cargo add open-tauri-remote-webview
```

> **Optional**: The `ws` Cargo feature (enabled by default) controls WebSocket support.
> Disable it with `--no-default-features` if you only need IPC in WebView and
> want to drop the WebSocket dependencies.

```rust
use open_tauri_remote_webview::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_webview::init())
    .setup(|app| {
        // Auto-start WebSocket server on launch
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            handle.start_remote_ui(
                RemoteUiConfig::default()
                    .set_port(Some(9090))
                    .enable_log(),    // Rust-side log output (default: on)
                    // .disable_log() // ← suppress server logs
            ).await.ok();
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![/* your commands */])
    .run(tauri::generate_context!())
    .expect("error running app");
```

If you use `emit()` / `emit_to()` / `emit_str()` / etc. in Rust, replace
`use tauri::Emitter` with `use open_tauri_remote_webview::EmitterExt` so events
also get forwarded to browser clients. `EmitterExt` is implemented for
`AppHandle`, `WebviewWindow`, and `Window` with the same **synchronous** signatures as
`tauri::Emitter` — it is a true drop-in replacement.

### 2. Frontend — zero-effort (recommended)

```bash
npm install open-tauri-remote-webview
```

In your app entry point (`main.ts` / `main.js`), add **one line** at the top:

```javascript
// Auto-inject __TAURI_INTERNALS__ WS proxy — @tauri-apps/api works everywhere
import "open-tauri-remote-webview/bridge-init";

// Keep using @tauri-apps/api as-is — no import changes needed
import { invoke } from "@tauri-apps/api/core";
import { getName } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
```

That's it. All `@tauri-apps/api` calls automatically go through IPC in
WebView and WebSocket in the browser — no `if (isTauri())` branches needed.

`bridge-init` also auto-shows a **WS connection status floating badge** (draggable,
click to expand debug panel). To suppress it:

```javascript
// Method 1 — set flag before import (globally disable)
window.__ORUI_DISABLE_BADGE__ = true;
import "open-tauri-remote-webview/bridge-init";

// Method 2 — call at runtime (toggle off)
import { disableFloatingBadge } from "open-tauri-remote-webview/api/core";
disableFloatingBadge();
```

By default the WS client auto-detects the server URL from `window.location`.
Override it with a global before import:

```javascript
// Option A — full URL override
window.__ORUI_WS_URL__ = "ws://192.168.1.100:9090/remote_ui_ws";

// Option B — port override (uses current hostname + custom port)
window.__ORUI_WS_PORT__ = 9090;

import "open-tauri-remote-webview/bridge-init";
```

### 3. Frontend — explicit API (alternative)

```javascript
import { invoke, setBaseUrl } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";
```

### 4. Vite dev proxy

```javascript
// vite.config.ts
server: {
  proxy: {
    "/remote_ui_ws": {
      target: "ws://127.0.0.1:9090",
      ws: true,
    },
  },
},
```

### 5. Start / Stop server manually

```rust
async fn enable_server(app: AppHandle, port: u16) -> Result<String, String> {
    app.start_remote_ui(
        RemoteUiConfig::default().set_port(Some(port))
    ).await.map_err(|e| e.to_string())?;
    Ok(format!("Server started on {}", port))
}

async fn disable_server(app: AppHandle) -> Result<String, String> {
    app.stop_remote_ui().await.map_err(|e| e.to_string())?;
    Ok("Server stopped".to_string())
}
```

---

## How the bridge works

### Async environment detection

`bridge-init` **asynchronously** detects the runtime environment before taking
any action:

```
module load
  ↓
waitForTauriDetection()  ← polls __TAURI_INTERNALS__ (up to 3s)
  ├── Native Tauri found  →  skip bridge, use real IPC
  └── Browser detected    →  install WS bridge shim
```

This eliminates race conditions where `__TAURI_INTERNALS__` isn't injected yet
when your frontend code runs. No `isTauri()` guards needed — the detection is
fully automatic.

### WS proxy shim

The `__TAURI_INTERNALS__` proxy shim (`installTauriBridge`) is injected when
your app runs in a browser. It mimics the real Tauri runtime:

```
Browser (@tauri-apps/api/*)
  ↓
window.__TAURI_INTERNALS__.invoke(cmd, args)
  ├── "plugin:event|listen"  ──→  local WS event system (no round-trip)
  ├── "plugin:event|unlisten" ──→  remove local listener
  └── everything else         ──→  WS → Rust → WebView IPC → response
```

- `transformCallback` / `runCallback` — managed locally in `ShimCallbackManager`
- `metadata` — hardcoded to `{ label: "main" }` (single-window mode)
- `convertFileSrc` — returns path as-is (browser has no asset protocol)
- `plugins.path` — inferred from `navigator.platform`
- `__TAURI_REMOTE_UI_SHIM__` flag — lets apps distinguish shim from real Tauri

### Frontend structured logging

All modules use a built-in structured logger (`src/logger.ts`) with timestamps
and log levels (`DEBUG` / `INFO` / `WARN` / `ERROR`). Open browser DevTools to
see detailed lifecycle traces — useful for debugging connection issues and
understanding the bridge initialization flow.

---

## WS Connection Status Floating Badge

`bridge-init` auto-shows a draggable connection status badge. Click to expand
the debug panel with latency, connect/reconnect count, uptime, WS URL, and logs.

```javascript
import { initFloatingBadge, disableFloatingBadge } from "open-tauri-remote-webview/api/core";

initFloatingBadge();      // show
disableFloatingBadge();   // hide
```

Features:
- **Status display**: connected / connecting / disconnected / error
- **Draggable**: move anywhere without blocking page content
- **Debug panel**: latency, connect count, reconnect count, uptime, WS address, error log
- **Auto-reconnect**: exponential backoff (1s → 2s → 4s → ... → 30s)

---

## Package exports

| Import path | What it provides |
|---|---|
| `open-tauri-remote-webview/bridge-init` | Side-effect — auto-install bridge (recommended) |
| `open-tauri-remote-webview/api/bridge` | `{ installTauriBridge }` — manual install |
| `open-tauri-remote-webview/api/core` | `{ invoke, setBaseUrl, getWsStatus, onWsStatusChange, getWsStats, initFloatingBadge, disableFloatingBadge }` |
| `open-tauri-remote-webview/api/event` | `{ listen, once }` |
| `open-tauri-remote-webview` | Re-exports all of the above |

---

## Plugin Development

```bash
# Build Rust
cargo build

# Build JS
cd guest-js && npm run build

# One shot: build JS → reinstall → launch test app (auto-watches guest-js for changes)
cargo xtask dev

# Step by step:
# 1) Build JS
cd guest-js && npm run build
# 2) Reinstall the local package in the test app
cd test/vue-app && pnpm remove open-tauri-remote-webview && pnpm install open-tauri-remote-webview@file:../../guest-js
# 3) Launch test app (with window + devtools)
cd test/vue-app && pnpm tauri dev

# Test app (headless, WS only — no window)
cd test/vue-app && npm run rdev
```

> `cargo xtask dev` also cleans ports 1420 and 9090 before starting, clears the
> Vite cache, and watches `guest-js/src/` + `guest-js/api/` for changes —
> automatically rebuilding JS and hot-reinstalling when files change.

---

## License

MIT — see [LICENSE](./LICENSE) for the full text.

Based on [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**, used under MIT.

Modifications and additions Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave).
