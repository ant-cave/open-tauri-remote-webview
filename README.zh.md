# Open Tauri Remote WebView

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

## 从原生 Tauri 迁移

将现有 Tauri 应用迁移到 `open-tauri-remote-webview` 只需少量改动。绝大部分前端代码**保持不变**。

### 改动对照

| 环节 | 之前（原生 Tauri） | 之后（远程模式） |
|---|---|---|
| Rust 插件 | — | 添加 `open-tauri-remote-webview` crate + `.plugin(open_tauri_remote_webview::init())` |
| Rust `window.emit()` | `use tauri::Emitter` | `use open_tauri_remote_webview::EmitterExt`（调用方式不变） |
| Rust 启动 WS 服务器 | — | 在 `setup` 中添加 `app.start_remote_ui(RemoteUiConfig::default())` |
| 前端安装 | — | `npm install open-tauri-remote-webview` |
| 前端导入 | `import "..." from "@tauri-apps/api"` | **无需改动** — 在入口加一行 `import "open-tauri-remote-webview/bridge-init"` |
| `vite.config.ts` | — | 添加 `/remote_ui_ws` 代理到 dev server |
| `if (isTauri())` 守卫 | 常见写法 | **删除它们** — 桥接让所有 API 统一工作 |

### 迁移步骤

1. **Rust 端：** `cargo add open-tauri-remote-webview`，然后在 `setup` 中注册插件并启动 WS 服务器（参见[使用方法 > Rust 端](#1-rust-端)）。
2. **前端：** `npm install open-tauri-remote-webview`，然后在入口文件顶部添加 `import "open-tauri-remote-webview/bridge-init"`（在任何 `@tauri-apps/api` 导入之前）。
3. **Vite：** 如果使用 Vite 开发服务器，添加 `/remote_ui_ws` 代理（参见[使用方法 > Vite 开发代理](#4-vite-开发代理)）。
4. **清理代码：** 删除所有 `isTauri()` / `isRunningInTauri()` 分支 — 桥接会自动判断环境：浏览器中走 WebSocket，WebView 中走真实 IPC。
5. **可选：** 将 Rust 代码中的 `use tauri::Emitter` 替换为 `use open_tauri_remote_webview::EmitterExt`，使后端发出的事件也能到达浏览器客户端。

### 保持不变的部分

- 所有 `@tauri-apps/api/*` 的导入和使用方式
- Rust 端的所有 Tauri 命令定义
- 所有前端构建工具（Vite、Webpack 等）
- 所有事件 `listen`/`once`/`emit` 的使用模式
- 所有窗口和应用 API 调用

### 注意事项

- **仅支持单窗口模式**：`getCurrentWindow()` 始终返回 `label: "main"`
- **无资产协议**：`convertFileSrc()` 原样返回路径，请使用原始 URL 访问资产
- **无 `__TAURI__` 环境变量**：桥接设置 `__TAURI_REMOTE_UI_SHIM__` 标记 — 如需检测 shim 环境可检查此标记

---

## 使用方法

### 1. Rust 端

```bash
cargo add open-tauri-remote-webview
```

```rust
use open_tauri_remote_webview::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_webview::init())
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
`use open_tauri_remote_webview::EmitterExt`，这样事件也会转发到浏览器客户端。

### 2. 前端 — 零改动（推荐）

```bash
npm install open-tauri-remote-webview
```

在应用入口（`main.ts` / `main.js`）顶部**加一行**：

```typescript
// 自动注入 __TAURI_INTERNALS__ WS 代理 — @tauri-apps/api 直接使用
import "open-tauri-remote-webview/bridge-init";

// 继续使用 @tauri-apps/api，无需任何导入改动
import { invoke } from "@tauri-apps/api/core";
import { getName } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
```

所有 `@tauri-apps/api` 调用在 WebView 中走 IPC、在浏览器中走 WebSocket，
无需写 `if (isTauri())` 分支。

`bridge-init` 会自动显示 **WS 连接状态悬浮窗**（可拖动，点击展开调试面板）。
如需关闭：

```typescript
// 方式 1 — import 前设置全局标记
window.__ORUI_DISABLE_BADGE__ = true;
import "open-tauri-remote-webview/bridge-init";

// 方式 2 — 运行时动态关闭
import { disableFloatingBadge } from "open-tauri-remote-webview/api/core";
disableFloatingBadge();
```

### 3. 前端 — 显式 API（备选）

```typescript
import { invoke, setBaseUrl } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";
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

`bridge-init` 会自动显示可拖动的连接状态悬浮窗，点击查看详细调试信息。
如需手动控制：

```typescript
import { initFloatingBadge, disableFloatingBadge } from "open-tauri-remote-webview/api/core";

initFloatingBadge();      // 显示
disableFloatingBadge();   // 关闭
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
| `open-tauri-remote-webview/bridge-init` | 副作用模块 — 自动安装桥接（推荐） |
| `open-tauri-remote-webview/api/bridge` | `{ installTauriBridge }` — 手动安装 |
| `open-tauri-remote-webview/api/core` | `{ invoke, setBaseUrl, getWsStatus, onWsStatusChange, getWsStats, initFloatingBadge, disableFloatingBadge }` |
| `open-tauri-remote-webview/api/event` | `{ listen, once }` |
| `open-tauri-remote-webview` | 重新导出以上所有内容 |

---

## 插件开发

```bash
# 编译 Rust
cargo build

# 编译 JS
cd guest-js && npm run build

# 一键编译 → 重新安装 → 启动测试（默认监视 guest-js 文件变化，自动重建）
cargo xtask dev

# 分步执行：
# 1) 编译 JS
cd guest-js && npm run build
# 2) 在 test 项目中重新安装本地包
cd test/vue-app && pnpm remove open-tauri-remote-webview && pnpm install open-tauri-remote-webview@file:../../guest-js
# 3) 启动测试应用（有窗口 + devtools）
cd test/vue-app && pnpm tauri dev

# 测试应用（无头模式，只跑 WS 无窗口）
cd test/vue-app && npm run rdev
```

---

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**，以 MIT 协议使用。

新增和修改部分 Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave)。
