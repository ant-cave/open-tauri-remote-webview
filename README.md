# Open Tauri Remote UI

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

## Usage

### 1. Rust side

```bash
cargo add open-tauri-remote-ui
```

```rust
use open_tauri_remote_ui::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_ui::init())
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
`use open_tauri_remote_ui::EmitterExt` so events also get forwarded to
browser clients.

### 2. Frontend — zero-effort (recommended)

```bash
npm install open-tauri-remote-ui
```

In your app entry point (`main.ts` / `main.js`), add **one line** at the top:

```typescript
// Auto-inject __TAURI_INTERNALS__ WS proxy — @tauri-apps/api works everywhere
import "open-tauri-remote-ui/bridge-init";

// Keep using @tauri-apps/api as-is — no import changes needed
import { invoke } from "@tauri-apps/api/core";
import { getName } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
```

That's it. All `@tauri-apps/api` calls automatically go through IPC in
WebView and WebSocket in the browser — no `if (isTauri())` branches needed.

### 3. Frontend — explicit API (alternative)

If you prefer explicit imports from this package instead of the transparent
bridge:

```typescript
import { invoke, setBaseUrl } from "open-tauri-remote-ui/api/core";
import { listen, once } from "open-tauri-remote-ui/api/event";
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
| `open-tauri-remote-ui/bridge-init` | Side-effect — auto-install bridge (recommended) |
| `open-tauri-remote-ui/api/bridge` | `{ installTauriBridge }` — manual install |
| `open-tauri-remote-ui/api/core` | `{ invoke, setBaseUrl }` |
| `open-tauri-remote-ui/api/event` | `{ listen, once }` |
| `open-tauri-remote-ui` | Re-exports all of the above |

---

## Plugin Development

```bash
# Build Rust
cargo build

# Build JS
cd guest-js && npm run build

# Test app
cd test/vue-app && npm run dev
```

---

## License

MIT — see [LICENSE](./LICENSE) for the full text.

Based on [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**, used under MIT.

Modifications and additions Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave).
