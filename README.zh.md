# Open Tauri Remote UI

一个 Tauri v2 插件，将应用的 UI 暴露到浏览器中，支持远程交互、前端调试，
以及使用标准 Web 测试工具进行端到端测试。**无需修改应用代码**。

本项目基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
by [DraviaVemal](https://github.com/DraviaVemal)，在 MIT 协议下修改。
所有新增代码 Copyright (c) 2026 **ant-cave**。

---

## 功能

| 能力 | WebView (IPC) | 浏览器 (WS) |
|---|---|---|
| `invoke`（任意命令） | ✅ | ✅ |
| 事件 `listen` / `once` | ✅ | ✅ |
| `@tauri-apps/api/app`（getName、getVersion …） | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/window`（title、size …） | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/event`（listen、emit） | ✅ | ✅ 通过桥接 |
| Rust 端 `emit` → 浏览器 | ✅ | ✅ 通过 `EmitterExt` |
| 安全控制 & 来源限制 | ✅ | ✅ |

---

## 使用方法

### 1. Rust 端

```bash
cargo add open-tauri-remote-ui
```

```rust
use open_tauri_remote_ui::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_ui::init())
    .setup(|app| {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            handle.start_remote_ui(
                RemoteUiConfig::default().set_port(Some(9090)),
            ).await.ok();
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![/* 你的命令 */])
    .run(tauri::generate_context!())
    .expect("error running app");
```

如果在 Rust 中使用 `window.emit()`，请将 `use tauri::Emitter` 替换为
`use open_tauri_remote_ui::EmitterExt`，这样事件也会转发到浏览器客户端。

### 2. 前端 — 零改动（推荐）

```bash
npm install open-tauri-remote-ui
```

在应用入口（`main.ts` / `main.js`）顶部**加一行**：

```typescript
// 自动注入 __TAURI_INTERNALS__ WS 代理 — @tauri-apps/api 直接使用
import "open-tauri-remote-ui/bridge-init";

// 继续使用 @tauri-apps/api，无需任何导入改动
import { invoke } from "@tauri-apps/api/core";
import { getName } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
```

所有 `@tauri-apps/api` 调用在 WebView 中走 IPC、在浏览器中走 WebSocket，
无需写 `if (isTauri())` 分支。

### 3. 前端 — 显式 API（备选）

```typescript
import { invoke, setBaseUrl } from "open-tauri-remote-ui/api/core";
import { listen, once } from "open-tauri-remote-ui/api/event";
```

### 4. Vite 开发代理

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

### 5. 手动启停服务

```rust
async fn enable_server(app: AppHandle, port: u16) -> Result<String, String> {
    app.start_remote_ui(
        RemoteUiConfig::default().set_port(Some(port))
    ).await.map_err(|e| e.to_string())?;
    Ok(format!("服务已启动，端口: {}", port))
}

async fn disable_server(app: AppHandle) -> Result<String, String> {
    app.stop_remote_ui().await.map_err(|e| e.to_string())?;
    Ok("服务已停止".to_string())
}
```

---

## 桥接原理

当应用在浏览器中运行时，`installTauriBridge` 会注入 `__TAURI_INTERNALS__` 代理 shim，
模拟真实的 Tauri 运行时：

```
浏览器 (@tauri-apps/api/*)
  ↓
window.__TAURI_INTERNALS__.invoke(cmd, args)
  ├── "plugin:event|listen"   ──→  本地 WS 事件系统（无需往返）
  ├── "plugin:event|unlisten" ──→  移除本地监听器
  └── 其他所有              ──→  WS → Rust → WebView IPC → 响应
```

- `transformCallback` / `runCallback` — 由 `ShimCallbackManager` 本地管理
- `metadata` — 固定为 `{ label: "main" }`（单窗口模式）
- `convertFileSrc` — 原样返回路径（浏览器没有资产协议）
- `plugins.path` — 从 `navigator.platform` 推断
- `__TAURI_REMOTE_UI_SHIM__` 标记 — 让应用区分 shim 与真实 Tauri

---

## WS 连接状态悬浮窗

在入口处调用即可显示可拖动的连接状态悬浮窗，点击查看详细调试信息：

```typescript
import { initFloatingBadge } from "open-tauri-remote-ui/api/core";

initFloatingBadge();
```

功能：
- **显示 WS 连接状态**：connected / connecting / disconnected / error
- **可拖动**：用指针对任意位置拖动，不遮挡页面内容
- **点击弹出调试面板**：显示延迟、连接次数、重连次数、在线时长、WS 地址等
- **自动重连**：连接断开后指数退避重连（1s → 2s → 4s → ... → 30s）

---

## 包导出

| 导入路径 | 内容 |
|---|---|
| `open-tauri-remote-ui/bridge-init` | 副作用模块 — 自动安装桥接（推荐） |
| `open-tauri-remote-ui/api/bridge` | `{ installTauriBridge }` — 手动安装 |
| `open-tauri-remote-ui/api/core` | `{ invoke, setBaseUrl, getWsStatus, onWsStatusChange, getWsStats, initFloatingBadge }` |
| `open-tauri-remote-ui/api/event` | `{ listen, once }` |
| `open-tauri-remote-ui` | 重新导出以上所有内容 |

---

## 插件开发

```bash
# 编译 Rust
cargo build

# 编译 JS
cd guest-js && npm run build

# 测试应用
cd test/vue-app && npm run dev
```

---

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**，以 MIT 协议使用。

新增和修改部分 Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave)。
