[中文版](./README.zh.md)

# Open Tauri Remote WebView

A Tauri v2 plugin that exposes your application's UI to any web browser, enabling
remote interaction, frontend debugging, and E2E testing using standard web tools.

This project is based on [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
by [DraviaVemal](https://github.com/DraviaVemal), modified under the MIT license.
All modifications are Copyright (c) 2026 **ant-cave**.

**Fork features:** transparent `@tauri-apps/api` proxy over WebSocket — all
native Tauri APIs (`app`, `window`, `event`, `core`, etc.) work in the browser
without any import changes. Just add one side-effect import.

Original by [DraviaVemal](https://github.com/DraviaVemal).
Enhanced by [ant-cave](https://github.com/ant-cave).

---

## Features

| Capability | WebView (IPC) | Browser (WS) |
|---|---|---|
| `invoke` (any command) | ✅ | ✅ |
| Event `listen` / `once` | ✅ | ✅ |
| `@tauri-apps/api/app` (getName, getVersion, …) | ✅ | ✅ via bridge |
| `@tauri-apps/api/window` (title, size, …) | ✅ | ✅ via bridge |
| `@tauri-apps/api/event` (listen, emit) | ✅ | ✅ via bridge |
| Rust `emit` → browser | ✅ | ✅ via `EmitterExt` |
| Custom security & origin control | ✅ | ✅ |

---

## Migration from Native Tauri

Migrating an existing Tauri app to use `open-tauri-remote-webview` requires only a few changes. Most of your frontend code stays **exactly the same**.

### What changes

| Area | Before (native Tauri) | After (remote) |
|---|---|---|
| Rust plugin | — | Add `open-tauri-remote-webview` crate + `.plugin(open_tauri_remote_webview::init())` |
| Rust `window.emit()` | `use tauri::Emitter` | `use open_tauri_remote_webview::EmitterExt` (same call) |
| Rust start WS server | — | Add `app.start_remote_ui(RemoteUiConfig::default())` in `setup` |
| Frontend install | — | `npm install open-tauri-remote-webview` |
| Frontend import | `import "..." from "@tauri-apps/api"` | **No change** — add ONE line: `import "open-tauri-remote-webview/bridge-init"` at entry |
| `vite.config.ts` | — | Add `/remote_ui_ws` proxy to dev server |
| `if (isTauri())` guards | Common pattern | **Remove them** — bridge makes everything work everywhere |

### Step-by-step

1. **Rust:** `cargo add open-tauri-remote-webview`, then register the plugin and start the WS server in `setup` (see [Usage > Rust side](#1-rust-side)).
2. **Frontend:** `npm install open-tauri-remote-webview`, then add `import "open-tauri-remote-webview/bridge-init"` at the top of your entry file (before any `@tauri-apps/api` import).
3. **Vite:** Add the `/remote_ui_ws` proxy if you use Vite dev server (see [Usage > Vite dev proxy](#4-vite-dev-proxy)).
4. **Clean up:** Delete all `isTauri()` / `isRunningInTauri()` branches — the bridge transparently proxies IPC calls to WebSocket when running in a browser, and passes through to real Tauri IPC when in WebView.
5. **Optional:** Replace `use tauri::Emitter` with `use open_tauri_remote_webview::EmitterExt` in your Rust code so events emitted from the backend also reach browser clients.

### What stays the same

- All `@tauri-apps/api/*` imports and usage
- All Tauri command definitions on the Rust side
- All frontend build tooling (Vite, Webpack, etc.)
- All event `listen`/`once`/`emit` patterns
- All window and app API calls

### Caveats

- **Single-window mode only**: `getCurrentWindow()` always returns with label `"main"`
- **No asset protocol**: `convertFileSrc()` returns the path as-is; use raw URLs for assets
- **No `__TAURI__` env**: the bridge sets `__TAURI_REMOTE_UI_SHIM__` instead — check this flag if you need to detect the shim

---

## Usage

### 1. Rust side

```bash
cargo add open-tauri-remote-webview
```

```rust
use open_tauri_remote_webview::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_webview::init())
    .setup(|app| {
        // Auto-start WebSocket server on launch
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            handle.start_remote_ui(
                RemoteUiConfig::default().set_port(Some(9090)),
            ).await.ok();
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![/* your commands */])
    .run(tauri::generate_context!())
    .expect("error running app");
```

If you use `window.emit()` in Rust, replace `use tauri::Emitter` with
`use open_tauri_remote_webview::EmitterExt` so events also get forwarded to
browser clients.

### 2. Frontend — zero-effort (recommended)

```bash
npm install open-tauri-remote-webview
```

In your app entry point (`main.ts` / `main.js`), add **one line** at the top:

```typescript
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

```typescript
// Method 1 — set flag before import (globally disable)
window.__ORUI_DISABLE_BADGE__ = true;
import "open-tauri-remote-webview/bridge-init";

// Method 2 — call at runtime (toggle off)
import { disableFloatingBadge } from "open-tauri-remote-webview/api/core";
disableFloatingBadge();
```

### 3. Frontend — explicit API (alternative)

If you prefer explicit imports from this package instead of the transparent
bridge:

```typescript
import { invoke, setBaseUrl } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";
```

### 4. Vite dev proxy

```typescript
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
# Build Rust (crate)
cargo build

# Build JS (this package)
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

---

## License

MIT — see [LICENSE](./LICENSE) for the full text.

Based on [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**, used under MIT.

Modifications and additions Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave).
