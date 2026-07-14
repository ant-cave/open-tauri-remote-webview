# Open Tauri Remote WebView — IPC WebSocket 桥接器 for Tauri v2

[![crates.io](https://img.shields.io/crates/v/open-tauri-remote-webview)](https://crates.io/crates/open-tauri-remote-webview)
[![npm](https://img.shields.io/npm/v/open-tauri-remote-webview)](https://www.npmjs.com/package/open-tauri-remote-webview)

**后端（Rust 库）：** `cargo add open-tauri-remote-webview` **（在 `src-tauri/` 目录下运行）**

**前端（JS）：** `npm install open-tauri-remote-webview` **（在项目根目录运行）**

> **English users see [English README](README.md)** — for complete documentation.

---

## 这是什么

本插件通过 WebSocket 暴露 Tauri 应用的 IPC 层（命令 + 事件），让浏览器可以像在原生 WebView 中一样调用 Tauri 命令和接收事件。

适用场景：
- **前端开发** — 在浏览器中使用完整 DevTools 开发和调试 Tauri 前端，无需安装 Rust/Tauri 工具链
- **E2E 测试** — 让 Playwright 或 Cypress 直接连接 Tauri 后端
- **CI/CD 测试** — 在 CI 中测试应用的 IPC 层，无需 xvfb

## 这不是什么

- **不是远程 WebView 渲染器** — 浏览器看不到 Tauri WebView 的渲染输出。它加载自己的前端副本，通过 WebSocket 通信。
- **不是真正的无头模式** — 通过 WS 调用的命令目前需要经过原生 WebView 分发。必须存在一个真正的 `WebviewWindow("main")`。通过 `CommandRegistry` API（见下文）可以去掉这一要求。
- **不是完整的 `@tauri-apps/api` 替代品** — 目前只桥接了 `invoke`、`listen` 和 `once`。`dialog`、`fs`、`shell` 等模块需要自定义命令。

本项目基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0) by [DraviaVemal](https://github.com/DraviaVemal)，在 MIT 协议下修改。所有新增代码 Copyright (c) 2026 **ant-cave**。

---

## 功能总览

| 能力 | WebView (IPC) | 浏览器 (WS) |
|---|---|---|
| `invoke`（任意命令） | ✅ | ✅ |
| 事件 `listen` / `once` | ✅ | ✅ |
| `@tauri-apps/api/app`（getName、getVersion 等） | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/window`（title、size 等） | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/event`（listen、emit） | ✅ | ✅ 通过桥接 |
| Rust 端 `emit` / `emit_to` / `emit_str` 等 → 浏览器 | ✅ | ✅ 通过 `EmitterExt` |
| IP 地址绑定控制（Localhost / Direct / Any） | ✅ | ✅ |
| WS 连接状态悬浮调试窗 | — | ✅ 自动显示 |

---

## 与原生 Tauri 的 API 一致性

本插件的设计目标是 **零迁移成本**。所有暴露的 API 签名与原生 Tauri 完全一致：

### Rust 端

| 原生 `tauri::Emitter` | 本插件 `open_tauri_remote_webview::EmitterExt` | 差异 |
|---|---|---|
| `fn emit(...)` **同步** | `fn emit(...)` **同步** ✅ | 无 |
| `fn emit_to(...)` 同步 | `fn emit_to(...)` 同步 ✅ | 无 |
| `fn emit_str(...)` 同步 | `fn emit_str(...)` 同步 ✅ | 无 |
| `fn emit_str_to(...)` 同步 | `fn emit_str_to(...)` 同步 ✅ | 无 |
| `fn emit_filter(...)` 同步 | `fn emit_filter(...)` 同步 ✅ | 无 |
| `fn emit_str_filter(...)` 同步 | `fn emit_str_filter(...)` 同步 ✅ | 无 |

**已实现于：** `AppHandle<R>`、`WebviewWindow<R>`、**`Window<R>`** — 三种类型全部 6 个 emit 方法一致可用。

**用法：** 只需把 `use tauri::Emitter` 替换为 `use open_tauri_remote_webview::EmitterExt`，所有调用无需任何改动。

### JS 端

| 原生 `@tauri-apps/api` | 本插件桥接模式 | 本插件显式 API | 差异 |
|---|---|---|---|
| `invoke<T>(cmd, args): Promise<T>` | 透明代理 ✅ | `invoke<T>(cmd, args)` ✅ | 无 |
| `listen<T>(event, handler): Promise<() => void>` | 透明代理 ✅ | `listen<T>(event, handler)` ✅ | 无 |
| `once<T>(event, handler): Promise<() => void>` | 透明代理 ✅ | `once<T>(event, handler)` ✅ | 无 |
| `emit(event, payload): Promise<void>` | 通用代理 ✅ | 未导出 | 走通用 invoke 路径（WS→eval），不像 `listen`/`once` 有本地优化 |

### 已知限制

| 限制 | 说明 | 解决方法 |
|---|---|---|
| **单窗口模式** | `getCurrentWindow()` 始终返回 `label: "main"` | 在命令中使用明确的窗口标签 |
| **无资产协议** | `convertFileSrc()` 原样返回路径 | 使用原始 URL 访问资产 |
| **无 `__TAURI__` 环境变量** | 桥接设置 `__TAURI_REMOTE_UI_SHIM__` 标记作为替代 | 检查两者之一 |
| **`invoke` 需要 WebView** | 未注册的命令需要通过真实的 `WebviewWindow("main")` 分发 | 在 `CommandRegistry` 中注册命令（见下文） |
| **未认证的 WS** | WebSocket 端点没有认证机制 | 使用防火墙/网络隔离 |
| **`@tauri-apps/api/dialog`** | 未桥接 | 通过自定义 Tauri 命令暴露 |
| **`@tauri-apps/api/fs`** | 未桥接 | 通过自定义 Tauri 命令暴露 |
| **`@tauri-apps/api/shell`** | 未桥接 | 通过自定义 Tauri 命令暴露 |

---

## 从原生 Tauri 迁移

将现有 Tauri 应用迁移到本插件只需少量改动。绝大部分前端代码**保持不变**。

### 改动对照

| 环节 | 之前（原生 Tauri） | 之后（远程模式） |
|---|---|---|
| Rust 插件 | — | 添加 crate + `.plugin(open_tauri_remote_webview::init())` |
| Rust `emit()` (AppHandle / WebviewWindow / Window) | `use tauri::Emitter` | `use open_tauri_remote_webview::EmitterExt`（调用方式不变） |
| Rust 启动 WS 服务器 | — | 在 `setup` 中添加 `app.start_remote_ui(...)` |
| 前端安装 | — | `npm install open-tauri-remote-webview` |
| 前端导入 | `@tauri-apps/api` | **无需改动** — 入口加一行 `import "open-tauri-remote-webview/bridge-init"` |
| `vite.config.ts` | — | 添加 `/remote_ui_ws` 代理 |
| `if (isTauri())` 守卫 | 常见写法 | **删除** — 桥接统一处理 |

### 迁移步骤

1. **Rust 端：** `cargo add open-tauri-remote-webview`，注册插件并启动 WS 服务器（见[使用方法](#使用方法)）。
2. **前端：** `npm install open-tauri-remote-webview`，在入口文件顶部添加 `import "open-tauri-remote-webview/bridge-init"`。
3. **Vite：** 添加 `/remote_ui_ws` 代理（见 [Vite 开发代理](#4-vite-开发代理)）。
4. **清理代码：** 删除所有 `isTauri()` 分支 —— 桥接自动判断环境。
5. **推荐：** 将 `use tauri::Emitter` 替换为 `use open_tauri_remote_webview::EmitterExt`，使后端事件也能到达浏览器客户端。

### 保持不变的部分

- 所有 `@tauri-apps/api/*` 的导入和使用方式
- Rust 端的所有 Tauri 命令定义
- 所有前端构建工具（Vite、Webpack 等）
- 所有事件 `listen`/`once`/`emit` 的使用模式
- 所有窗口和应用 API 调用

---

## 使用方法

### 1. Rust 端

```bash
cargo add open-tauri-remote-webview
```

> **可选**：Cargo 特性 `ws`（默认启用）控制 WebSocket 支持。如果只需要 WebView
> 中的 IPC 模式，可以用 `--no-default-features` 禁用以减小依赖体积。

```rust
use open_tauri_remote_webview::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_webview::init())
    .setup(|app| {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            handle.start_remote_ui(
                RemoteUiConfig::default()
                    .set_port(Some(9090))
                    .enable_log()     // Rust 端日志输出（默认开启）
                    // .disable_log()  // ← 关闭服务端日志
            ).await.ok();
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![/* 你的命令 */])
    .run(tauri::generate_context!())
    .expect("error running app");
```

如果在 Rust 中使用 `emit()` / `emit_to()` / `emit_str()` 等，请将 `use tauri::Emitter` 替换为
`use open_tauri_remote_webview::EmitterExt`，这样事件也会转发到浏览器客户端。
`EmitterExt` 已为 `AppHandle`、`WebviewWindow` **和 `Window`** 实现，签名与原生完全一致。

### 2. 前端 — 零改动（推荐）

```bash
npm install open-tauri-remote-webview
```

在应用入口（`main.ts` / `main.js`）顶部**加一行**：

```javascript
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

```javascript
// 方式 1 — import 前设置全局标记
window.__ORUI_DISABLE_BADGE__ = true;
import "open-tauri-remote-webview/bridge-init";

// 方式 2 — 运行时动态关闭
import { disableFloatingBadge } from "open-tauri-remote-webview/api/core";
disableFloatingBadge();
```

WS 客户端默认根据 `window.location` 自动检测服务端地址。
可以通过 import 前的全局变量覆盖：

```javascript
// 方式 A — 完整 URL 覆盖
window.__ORUI_WS_URL__ = "ws://192.168.1.100:9090/remote_ui_ws";

// 方式 B — 仅覆盖端口（使用当前 hostname）
window.__ORUI_WS_PORT__ = 9090;

import "open-tauri-remote-webview/bridge-init";
```

### 3. 前端 — 显式 API（备选）

```javascript
import { invoke, setBaseUrl } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";
```

### 4. Vite 开发代理

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

### 5. CommandRegistry — 无需 WebView 调用 invoke（可选）

默认情况下，通过 WS 调用的命令需要经过真实的 `WebviewWindow("main")` 通过 `window.eval()` 分发。要消除这一依赖，让命令**无需任何 WebView** 也能工作，可以在 `CommandRegistry` 中注册它们：

```rust
use open_tauri_remote_webview::{CommandRegistry, RemoteUiConfig, RemoteUiExt};
use serde_json::Value;

fn my_command(args: Option<Value>) -> Result<Value, String> {
    // 解析参数并返回结果
    Ok(serde_json::json!({"status": "ok"}))
}

tauri::Builder::default()
    .plugin(open_tauri_remote_webview::init())
    .setup(|app| {
        // 注册命令，实现无头 WS 访问
        let registry = app.state::<CommandRegistry>();
        registry.register("my_command", my_command);

        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            handle.start_remote_ui(RemoteUiConfig::default()).await.ok();
        });
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error running app");
```

在 `CommandRegistry` 中注册的命令直接从 Rust 分发——无需 `window.eval()`，无需 WebView。未在注册表中找到的命令会回退到 WebView 路径，保持向后兼容。

> **注意：** 使用 `CommandRegistry` 时，你的命令函数接收原始的 `Option<Value>` 参数，需要手动解析。这是比 `#[tauri::command]` 更低层的 API，但独立于 Tauri 的 IPC 系统。

### 6. 手动启停服务

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

### 环境检测

`bridge-init` 会**立即**检测运行环境（无需轮询）：

1. **设置了 `__ORUI_WS_URL__` 或 `__ORUI_WS_PORT__`** → 浏览器模式（用户显式指定 WS）
2. **存在 `__TAURI_INTERNALS__`**（且不是 shim）→ 原生 Tauri 模式
3. **其他情况** → 浏览器模式（WS 桥接）

```
模块加载
  ↓
检查全局变量
  ├── __ORUI_WS_URL__/__ORUI_WS_PORT__ 已设置  →  安装 WS 桥接 shim
  ├── __TAURI_INTERNALS__ 存在（原生）           →  跳过桥接，使用真实 IPC
  └── 其他                                      →  安装 WS 桥接 shim
```

无需轮询、无需 User-Agent 检测、无需 3 秒延迟。

### WS 代理 shim

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

### 前端结构化日志

所有模块均使用内置的结构化日志系统（`src/logger.ts`），输出带时间戳和
日志级别（`DEBUG` / `INFO` / `WARN` / `ERROR`）。打开浏览器 DevTools
即可看到完整的组件初始化流程，对调试连接问题非常有帮助。

---

## WS 连接状态悬浮窗

`bridge-init` 会自动显示可拖动的连接状态悬浮窗，点击查看详细调试信息。
如需手动控制：

```javascript
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
|---|---|---|
| `open-tauri-remote-webview/bridge-init` | 副作用模块 — 自动安装桥接（推荐） |
| `open-tauri-remote-webview/api/bridge` | `{ installTauriBridge }` — 手动安装 |
| `open-tauri-remote-webview/api/core` | `{ invoke, setBaseUrl, getWsStatus, onWsStatusChange, getWsStats, initFloatingBadge, disableFloatingBadge }` |
| `open-tauri-remote-webview/api/event` | `{ listen, once }` |
| `open-tauri-remote-webview/floating-badge` | `{ initFloatingBadge, disableFloatingBadge }` — 独立导入 |
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

> `cargo xtask dev` 还会在启动前清理 1420 和 9090 端口、清除 Vite 缓存、
> 并监视 `guest-js/src/` + `guest-js/api/` 目录的文件变化 ——
> 自动重建 JS 并热重装到测试应用。

---

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**，以 MIT 协议使用。

新增和修改部分 Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave)。
